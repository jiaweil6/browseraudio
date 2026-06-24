// live.js — boots a REAL in-browser Python kernel for the Record page.
//
// Unlike play.html (which drives the frontend modules directly, no kernel),
// recording needs the genuine round-trip: record() displays an anywidget
// Recorder whose samples come back to Python over the widget comm. So this page
// runs the actual browseraudio package on a thebe + thebe-lite + Pyodide kernel,
// exactly as it would in JupyterLite / thebe.
//
// Design mirrors icmbook's live-cells.js, slimmed for this demo's simple DOM:
//   - On page load: mount editors over the .cell <pre> blocks (CodeMirror),
//     styled to match via live.css. The kernel does NOT boot yet — bootstrap's
//     server start is parked behind a gate so Pyodide/the 25 MB stack load only
//     on the first Run.
//   - On first Run: load thebe-lite, open the gate (injecting the pinned
//     Pyodide + self-hosted piplite settings), await the kernel, micropip-install
//     browseraudio, then execute cells. thebe renders outputs — including the
//     Recorder widget — which we relocate into each cell's .cell-out area.
//
// NOTE: the anywidget Recorder actually rendering in thebe-lite can only be
// confirmed in a browser with a microphone — see demo/README.md.
(function () {
  "use strict";

  // Everything is addressed relative to the page's own directory, so the demo
  // works at any path / static host.
  var BASE = new URL(".", document.baseURI).href;
  var url = function (p) { return new URL(p, BASE).href; };

  var bootPromise = null; // thebelab.bootstrap() -> { server, session, notebook }
  var kernelPromise = null; // single-flight: first Run -> kernel ready
  var openGate = null; // releases the parked server start on first Run
  var nbRef = null;
  var sessionRef = null;
  var ranIds = Object.create(null); // thebe cell ids executed since boot

  // Pin the kernel runtime, self-hosting piplite's wheels next to the bundle
  // (same versions icmbook ships). Pyodide 0.27.7: pyquist/numpy>=2 need >=0.27,
  // and pyodide_kernel 0.4.7 (in thebe-lite 0.5.0) breaks on >=0.28.
  var liteSettings = {
    "@jupyterlite/pyodide-kernel-extension:kernel": {
      pyodideUrl: "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js",
      pipliteUrls: [url("vendor/thebe-dist/lite/pypi/all.json")],
      pipliteWheelUrl: url("vendor/thebe-dist/lite/pypi/piplite-0.4.7-py3-none-any.whl"),
    },
  };

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("failed to load " + src)); };
      document.head.appendChild(s);
    });
  }

  function setStatus(text, busy) {
    var s = document.querySelector("#kstat");
    var d = document.querySelector("#kdot");
    if (s) s.textContent = text;
    if (d) d.classList.toggle("busy", !!busy);
  }

  function cells() {
    return Array.prototype.slice.call(document.querySelectorAll(".cell"));
  }

  function thebeConfig() {
    return {
      useJupyterLite: true,
      useBinder: false,
      requestKernel: true,
      kernelOptions: { name: "python", path: "/" },
      // We drive execution from the page's own Run buttons.
      mountRunButton: false,
      mountRunAllButton: false,
      mountRestartButton: false,
      mountRestartallButton: false,
      mountRestartAllButton: false,
      // The classic thebe contract: each element marked data-executable (the
      // cell's <pre>, tagged in mount()) becomes a live editor + output area.
      selector: "[data-executable]",
      // No line numbers — the demo's static blocks had none.
      codeMirrorConfig: { readOnly: false, lineNumbers: false },
    };
  }

  // ----- mount editors (no kernel yet) -----------------------------------

  async function mount() {
    // Mark each cell's source <pre> executable, the way thebe expects.
    cells().forEach(function (cell) {
      var pre = cell.querySelector("pre.cell-code");
      if (!pre) return;
      pre.setAttribute("data-executable", "true");
      pre.setAttribute("data-language", "python");
    });

    // The gate: bootstrap() starts the JupyterLite server immediately, which
    // needs window.thebeLite. This placeholder satisfies that and parks the
    // start on a promise we only resolve on the first Run — so the mount is
    // free of Pyodide and the ~25 MB stack.
    var gate = new Promise(function (resolve) { openGate = resolve; });
    window.thebeLite = {
      startJupyterLiteServer: function (cfg) {
        return gate.then(function (start) { return start(cfg); });
      },
    };

    await loadScript(url("vendor/thebe-dist/core/index.js"));
    document.body.classList.add("live-active"); // enables editor-parity CSS

    bootPromise = window.thebelab.bootstrap(thebeConfig());
    bootPromise.catch(function (e) { console.error("[live] bootstrap", e); });

    await waitForEditors();
    // Output areas are relocated lazily, only once a cell has run — so empty
    // "output" boxes don't show under unrun cells.
    setStatus("ready — click Run to start Python", false);
  }

  function waitForEditors() {
    var want = cells().length;
    return new Promise(function (resolve, reject) {
      var t0 = Date.now();
      (function poll() {
        if (document.querySelectorAll(".cell .CodeMirror").length >= want) return resolve();
        if (Date.now() - t0 > 10000) return reject(new Error("editors did not mount"));
        setTimeout(poll, 50);
      })();
    });
  }

  // thebe renders a cell's live output into a .jp-OutputArea it creates inside
  // the cell. Move it into the page's own .cell-out box so results sit where the
  // design puts them (and pick up the widget/audio styling in style.css).
  function placeOutput(cell) {
    var out = cell.querySelector(".cell-out");
    var area = cell.querySelector(".jp-OutputArea");
    if (!out || !area || out.contains(area)) return;
    out.hidden = false;
    out.appendChild(area);
  }

  // ----- kernel boot (first Run) -----------------------------------------

  function ensureKernel() {
    if (!kernelPromise) {
      kernelPromise = startKernel().catch(function (err) {
        setStatus("error: " + (err && err.message ? err.message : err), false);
        throw err;
      });
    }
    return kernelPromise;
  }

  async function startKernel() {
    setStatus("starting Python — first run downloads ~25 MB…", true);
    await loadScript(url("vendor/thebe-dist/lite/thebe-lite.min.js"));

    // The lite bundle just installed the real startJupyterLiteServer over our
    // placeholder; opening the gate hands the parked call a wrapper that injects
    // the pinned runtime settings into the real start.
    var realStart = window.thebeLite.startJupyterLiteServer;
    openGate(function (cfg) {
      cfg = Object.assign({}, cfg);
      cfg.litePluginSettings = Object.assign({}, cfg.litePluginSettings, liteSettings);
      return realStart.call(window.thebeLite, cfg);
    });

    var boot = await bootPromise;
    nbRef = boot.notebook;
    sessionRef = boot.session;

    setStatus("installing browseraudio…", true);
    await installBrowseraudio();

    // Leaving now would drop kernel state; reload is the reset affordance.
    window.addEventListener("beforeunload", function (e) {
      e.preventDefault();
      e.returnValue = "";
    });
    setStatus("● Python connected — reload page to reset", false);
  }

  async function installBrowseraudio() {
    var lines = [
      // Pre-load the WASM build of numpy so micropip doesn't reach for a PyPI
      // wheel that needs native libraries, then pull browseraudio (+ anywidget)
      // from PyPI.
      "import pyodide_js",
      "from pyodide.ffi import to_js",
      'await pyodide_js.loadPackage(to_js(["numpy"]))',
      "import micropip",
      'await micropip.install("browseraudio")',
    ];
    var fut = sessionRef.kernel.requestExecute({ code: lines.join("\n") });
    var kernelErr = null;
    fut.onIOPub = function (m) {
      var c = m.content || {};
      if (c.ename) {
        kernelErr = c.ename + ": " + c.evalue;
        console.error("[live] kernel:", kernelErr);
      }
    };
    var reply = await fut.done;
    var st = reply && reply.content && reply.content.status;
    if (st && st !== "ok") {
      throw new Error("environment setup failed — " + (kernelErr || "see console"));
    }
  }

  // ----- execution -------------------------------------------------------

  function nbCellOf(cell) {
    var marked = cell.querySelector("[data-thebe-id]");
    if (!marked || !nbRef) return null;
    var id = marked.getAttribute("data-thebe-id");
    return nbRef.cells.find(function (c) { return c.id === id; }) || null;
  }

  // Run the target cell, first running any earlier cells not yet run this
  // session (a fresh kernel can't satisfy `rec.samples` otherwise).
  async function runUpTo(targetCell) {
    await ensureKernel();
    var chain = cells();
    for (var i = 0; i < chain.length; i++) {
      var cell = chain[i];
      var nb = nbCellOf(cell);
      if (!nb) continue;
      var isTarget = cell === targetCell;
      if (isTarget || !ranIds[nb.id]) {
        await nb.execute();
        ranIds[nb.id] = true;
        placeOutput(cell);
      }
      if (isTarget) break;
    }
  }

  var queue = Promise.resolve();
  function enqueue(targetCell) {
    var buttons = document.querySelectorAll(".run, .run-all");
    buttons.forEach(function (b) { b.disabled = true; });
    setStatus(kernelPromise ? "running…" : "starting Python…", true);
    queue = queue
      .then(function () { return runUpTo(targetCell); })
      .then(function () { setStatus("● ready", false); })
      .catch(function (err) {
        console.error("[live] run", err);
        setStatus("error: " + (err && err.message ? err.message : err), false);
      })
      .then(function () { buttons.forEach(function (b) { b.disabled = false; }); });
    return queue;
  }

  function wire() {
    document.querySelectorAll(".run[data-run]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var cell = btn.closest(".cell");
        if (cell) enqueue(cell);
      });
    });
    var runAll = document.querySelector("#run-all");
    if (runAll) {
      runAll.addEventListener("click", function () {
        var all = cells();
        if (all.length) enqueue(all[all.length - 1]); // last cell runs the chain
      });
    }
  }

  wire();
  setStatus("loading editor…", true);
  mount().catch(function (err) {
    console.error("[live] mount", err);
    setStatus("editor failed to load — see console", false);
  });
})();

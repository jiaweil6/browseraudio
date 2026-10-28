// live.js — runs the demo cells on a real thebe-lite + Pyodide kernel. Editors mount
// on load; the kernel (~25 MB) boots on the first Run, installs browseraudio, and
// thebe's outputs are moved into each cell's .cell-out box.
(function () {
  "use strict";

  // Paths relative to the page, so the demo works on any static host.
  var BASE = new URL(".", document.baseURI).href;
  var url = function (p) { return new URL(p, BASE).href; };

  var bootPromise = null; // thebelab.bootstrap() -> { server, session, notebook }
  var kernelPromise = null; // single-flight: first Run -> kernel ready
  var openGate = null; // releases the parked server start on first Run
  var nbRef = null;
  var sessionRef = null;
  var ranIds = Object.create(null); // thebe cell ids executed since boot

  // Pinned runtime: pyquist / numpy>=2 need Pyodide >= 0.27; pyodide_kernel 0.4.7
  // (thebe-lite 0.5.0) breaks on >= 0.28. piplite wheels are self-hosted.
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
      mountRunButton: false,
      mountRunAllButton: false,
      mountRestartButton: false,
      mountRestartallButton: false,
      mountRestartAllButton: false,
      // Each [data-executable] <pre> becomes a live editor + output area.
      selector: "[data-executable]",
      codeMirrorConfig: { readOnly: false, lineNumbers: false },
    };
  }

  async function mount() {
    cells().forEach(function (cell) {
      var pre = cell.querySelector("pre.cell-code");
      if (!pre) return;
      pre.setAttribute("data-executable", "true");
      pre.setAttribute("data-language", "python");
    });

    // bootstrap() starts the JupyterLite server at once; park it behind a gate
    // opened on the first Run, so loading the page doesn't load Pyodide.
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
    // Output boxes appear only once a cell has run.
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

  // Move thebe's output area into the page's .cell-out box.
  function placeOutput(cell) {
    var out = cell.querySelector(".cell-out");
    var area = cell.querySelector(".jp-OutputArea");
    if (!out || !area || out.contains(area)) return;
    out.hidden = false;
    out.appendChild(area);
  }

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

    // Open the gate with the real start, plus the pinned runtime settings.
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

    // Leaving drops kernel state; reload resets.
    window.addEventListener("beforeunload", function (e) {
      e.preventDefault();
      e.returnValue = "";
    });
    setStatus("● Python connected — reload page to reset", false);
  }

  // Prefer the wheel built from this deploy (wheels/manifest.json); else PyPI.
  async function browseraudioSpec() {
    try {
      var res = await fetch(url("wheels/manifest.json"), { cache: "no-store" });
      if (res.ok) {
        var manifest = await res.json();
        if (manifest && manifest.wheel) return url("wheels/" + manifest.wheel);
      }
    } catch (e) {
      /* no manifest: use PyPI */
    }
    return "browseraudio";
  }

  async function installBrowseraudio() {
    var spec = await browseraudioSpec();
    var lines = [
      // Load Pyodide's numpy first so micropip doesn't fetch a native wheel.
      "import pyodide_js",
      "from pyodide.ffi import to_js",
      'await pyodide_js.loadPackage(to_js(["numpy"]))',
      "import micropip",
      "await micropip.install(" + JSON.stringify(spec) + ")",
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

  function nbCellOf(cell) {
    var marked = cell.querySelector("[data-thebe-id]");
    if (!marked || !nbRef) return null;
    var id = marked.getAttribute("data-thebe-id");
    return nbRef.cells.find(function (c) { return c.id === id; }) || null;
  }

  // Run the target cell, after any earlier cells not yet run.
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

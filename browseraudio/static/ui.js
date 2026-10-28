// ui.js — shared look and controls. Widgets render in a Shadow DOM; in Jupyter
// frontends they use the --jp-* theme, elsewhere the page's text colour and font.

const BA_STYLE = `
:host { all: initial; display: block; margin: 6px 0; max-width: 820px;
  color: inherit; font-family: inherit; font-size: 13px; line-height: 1.45;
  --ba-fg: currentColor;
  --ba-muted: color-mix(in srgb, currentColor 60%, transparent);
  --ba-line: color-mix(in srgb, currentColor 17%, transparent);
  --ba-surface: color-mix(in srgb, currentColor 4%, transparent);
  --ba-surface-2: color-mix(in srgb, currentColor 9%, transparent);
  --ba-bg: transparent;
  --ba-accent: #3d7be0; --ba-accent-fg: #fff;
  --ba-danger: #d64560; --ba-ok: #2e9d5b; --ba-warn: #c58a1b;
  --ba-font: inherit;
  --ba-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}
:host(.ba-jp) { color: var(--jp-ui-font-color1, #1f2328);
  --ba-muted: var(--jp-ui-font-color2, #6e7781);
  --ba-line: var(--jp-border-color2, #d8dee4);
  --ba-surface: var(--jp-layout-color2, #f2f3f5);
  --ba-surface-2: var(--jp-layout-color3, #e4e6ea);
  --ba-bg: var(--jp-layout-color1, #fff);
  --ba-accent: var(--jp-brand-color1, #1976d2);
  --ba-danger: var(--jp-error-color1, #d32f2f);
  --ba-ok: var(--jp-success-color1, #388e3c);
  --ba-warn: var(--jp-warn-color1, #f57c00);
  --ba-font: var(--jp-ui-font-family, system-ui, sans-serif);
  --ba-mono: var(--jp-code-font-family, ui-monospace, monospace);
}
* { box-sizing: border-box; }
.ba { position: relative; font-family: var(--ba-font); color: var(--ba-fg);
  background: var(--ba-bg); background-image: linear-gradient(var(--ba-surface), var(--ba-surface));
  border: 1px solid var(--ba-line); border-radius: 12px; padding: 10px 12px; outline: none;
  user-select: none; -webkit-user-select: none; }
.ba:focus-visible, .ba.ba-listening { border-color: var(--ba-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ba-accent) 22%, transparent); }
.ba-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.ba-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ba-name { font-weight: 650; letter-spacing: 0.01em; }
.ba-pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px 2px 7px;
  border-radius: 999px; background: var(--ba-surface-2); color: var(--ba-muted);
  font-size: 12px; white-space: nowrap; }
.ba-pill i { width: 7px; height: 7px; border-radius: 50%; background: var(--ba-muted); }
.ba-pill[data-kind="ready"] i { background: var(--ba-ok); }
.ba-pill[data-kind="live"] i { background: var(--ba-accent); animation: ba-pulse 1.2s ease-in-out infinite; }
.ba-pill[data-kind="rec"] i { background: var(--ba-danger); animation: ba-pulse 1s ease-in-out infinite; }
.ba-pill[data-kind="load"] i { background: var(--ba-warn); animation: ba-pulse 0.8s ease-in-out infinite; }
.ba-pill[data-kind="error"] i { background: var(--ba-danger); }
.ba-pill[data-kind="live"], .ba-pill[data-kind="rec"] { color: var(--ba-fg); }
@keyframes ba-pulse { 50% { opacity: 0.35; } }
.ba-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.ba-body { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.ba-body:empty { display: none; }
.ba-row { display: flex; align-items: center; gap: 10px; }
.ba-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid transparent;
  font: 600 13px/1 var(--ba-font); cursor: pointer; white-space: nowrap;
  background: var(--ba-accent); color: var(--ba-accent-fg);
  transition: filter 0.12s, background 0.12s; }
.ba-btn:hover { filter: brightness(1.08); }
.ba-btn:active { filter: brightness(0.95); }
.ba-btn.ba-secondary { background: var(--ba-surface-2); color: var(--ba-fg); border-color: var(--ba-line); }
.ba-btn[disabled] { opacity: 0.45; cursor: default; filter: none; }
.ba-btn svg { width: 12px; height: 12px; fill: currentColor; flex: none; }
.ba-btn.ba-icon-only { width: 30px; padding: 0; }
.ba-btn:focus-visible, .ba-seg button:focus-visible, .ba-pad:focus-visible {
  outline: 2px solid var(--ba-accent); outline-offset: 2px; }
.ba-seg { display: inline-flex; padding: 2px; border-radius: 9px; background: var(--ba-surface-2); }
.ba-seg button { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 7px;
  font: 600 12px/1.2 var(--ba-font); color: var(--ba-muted); }
.ba-seg button[aria-pressed="true"] { background: var(--ba-bg); color: var(--ba-fg);
  background-image: linear-gradient(var(--ba-surface), var(--ba-surface));
  box-shadow: 0 1px 2px rgba(0,0,0,0.12); }
.ba-track { position: relative; flex: 1; height: 6px; border-radius: 3px; background: var(--ba-surface-2); overflow: hidden; }
.ba-fill { position: absolute; inset: 0 auto 0 0; width: 0; border-radius: 3px; background: var(--ba-accent); }
.ba-meter .ba-fill { background: linear-gradient(90deg, var(--ba-ok) 60%, var(--ba-warn) 85%, var(--ba-danger)); }
.ba-time { font: 12px var(--ba-mono); color: var(--ba-muted); white-space: nowrap; min-width: 92px; text-align: right; }
.ba-foot { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; font-size: 11.5px; color: var(--ba-muted); }
.ba-foot:empty { display: none; }
.ba-stats { font-family: var(--ba-mono); }
.ba-credit a { color: var(--ba-accent); text-decoration: none; }
.ba-credit a:hover { text-decoration: underline; }
.ba-note { margin-top: 8px; padding: 6px 9px; border-radius: 8px; font-size: 12.5px;
  color: var(--ba-danger); background: color-mix(in srgb, var(--ba-danger) 10%, transparent); white-space: pre-wrap; }
.ba-note.ba-info { color: var(--ba-fg); background: var(--ba-surface-2); }
.ba-note[hidden] { display: none; }
.ba-hint { font-size: 12px; color: var(--ba-muted); }
.ba-hint kbd { font: 11px var(--ba-mono); padding: 1px 4px; border-radius: 4px;
  border: 1px solid var(--ba-line); background: var(--ba-surface-2); }
/* 88-key strip */
.ba-piano { position: relative; height: 34px; display: flex; border-radius: 4px; overflow: hidden;
  border: 1px solid var(--ba-line); }
.ba-piano .w { flex: 1; background: #fbfbfa; border-right: 1px solid #d6d6d6; }
.ba-piano .w:last-child { border-right: 0; }
.ba-piano .b { position: absolute; top: 0; height: 60%; background: #2b2d31; border-radius: 0 0 2px 2px; }
.ba-piano .on { background: var(--ba-accent) !important; }
/* musical-typing keys */
.ba-tiles { display: flex; flex-wrap: wrap; gap: 4px; align-items: flex-start; }
.ba-tile { flex: 1 1 0; min-width: 28px; max-width: 52px; height: 60px; padding: 5px 3px 4px; display: flex; flex-direction: column;
  justify-content: space-between; align-items: center; border-radius: 7px; cursor: pointer;
  background: #fbfbfa; color: #1f2328; border: 1px solid #d0d3d8; touch-action: none; }
.ba-tile.black { background: #2b2d31; color: #eceef1; border-color: #4a4d55; height: 48px; }
.ba-tile.ctl { background: transparent; color: var(--ba-fg); border: 1px dashed var(--ba-line); height: 42px; }
.ba-tile.down { background: var(--ba-accent); color: var(--ba-accent-fg); border-color: var(--ba-accent); }
.ba-tile b { font-size: 14px; font-weight: 650; }
.ba-tile small { font-size: 10px; opacity: 0.75; white-space: nowrap; }
/* genie pads */
.ba-pads { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; }
.ba-pad { height: 66px; border-radius: 10px; cursor: pointer; touch-action: none; border: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  color: #fff; font-family: var(--ba-font); background: hsl(var(--h) 62% 52%);
  box-shadow: inset 0 -3px 0 rgba(0,0,0,0.18); transition: transform 0.05s, filter 0.05s; }
.ba-pad b { font-size: 18px; font-weight: 700; line-height: 1; }
.ba-pad small { font-size: 10.5px; opacity: 0.85; }
.ba-pad.down { transform: translateY(2px); filter: brightness(1.25); box-shadow: none; }
@media (max-width: 520px) {
  .ba-tile { min-width: 22px; height: 52px; padding: 4px 1px; }
  .ba-tile b { font-size: 12.5px; }
  .ba-tile.black { height: 42px; }
  .ba-pad { height: 54px; }
  .ba-time { min-width: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .ba-pill i, .ba-btn, .ba-pad { animation: none !important; transition: none !important; }
}
`;

const BA_ICONS = {
  play: '<svg viewBox="0 0 12 12"><path d="M2.5 1.2v9.6L10.6 6z"/></svg>',
  stop: '<svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1.2"/></svg>',
  record: '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.4"/></svg>',
};

const BA_GENIE_CREDIT =
  'Genie mode: <a href="https://arxiv.org/abs/1810.03226" target="_blank" rel="noopener">Piano Genie</a> ' +
  "(Donahue, Simon &amp; Dieleman, IUI 2019) · " +
  '<a href="https://magenta.tensorflow.org/pianogenie" target="_blank" rel="noopener">Magenta</a> model';

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const BLACK = new Set([1, 3, 6, 8, 10]);
const noteName = (midi) => NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function fmtTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return m + ":" + (s - 60 * m).toFixed(1).padStart(4, "0");
}

function newAudioContext(options) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  return new AudioCtx(options);
}

function baEl(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

// Use the Jupyter palette when the page is a Jupyter frontend.
function watchTheme(host) {
  const apply = () => host.classList.toggle("ba-jp", !!(document.body && document.body.dataset.jpThemeLight));
  apply();
  const observer = new MutationObserver(apply);
  if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ["data-jp-theme-light"] });
  return () => observer.disconnect();
}

// The shared frame: title, status, actions, body, notice, footer.
function mountUI(el_, title) {
  const host = baEl("div", "browseraudio-widget");
  // Suppress JupyterLab shortcuts (shadow-DOM events retarget to the host).
  host.dataset.lmSuppressShortcuts = "true";
  host.dataset.pSuppressShortcuts = "true";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML =
    `<style>${BA_STYLE}</style>` +
    `<div class="ba"><div class="ba-head"><div class="ba-title"><span class="ba-name"></span>` +
    `<span class="ba-pill" data-kind="idle"><i></i><span></span></span></div>` +
    `<div class="ba-actions"></div></div><div class="ba-body"></div>` +
    `<div class="ba-note" hidden></div><div class="ba-foot"><span class="ba-stats"></span>` +
    `<span class="ba-credit"></span></div></div>`;
  el_.appendChild(host);
  const $ = (sel) => shadow.querySelector(sel);
  $(".ba-name").textContent = title;
  const stopTheme = watchTheme(host);
  const pill = $(".ba-pill");
  const note = $(".ba-note");
  return {
    host,
    shadow,
    root: $(".ba"),
    head: $(".ba-head"),
    actions: $(".ba-actions"),
    body: $(".ba-body"),
    status(kind, text) {
      pill.dataset.kind = kind;
      pill.lastElementChild.textContent = text;
    },
    stats(text) {
      $(".ba-stats").textContent = text || "";
    },
    credit(html) {
      $(".ba-credit").innerHTML = html || "";
    },
    note(text, kind) {
      note.textContent = text || "";
      note.className = "ba-note" + (kind === "info" ? " ba-info" : "");
      note.hidden = !text;
    },
    hasFocus() {
      return shadow.activeElement !== null;
    },
    destroy() {
      stopTheme();
    },
  };
}

// A button with an icon; `set()` swaps icon / label / state.
function uiButton({ icon, label, title, secondary, onClick }) {
  const b = baEl("button", "ba-btn" + (secondary ? " ba-secondary" : ""));
  b.type = "button";
  b.set = (opts) => {
    if (opts.icon !== undefined || opts.label !== undefined) {
      const i = opts.icon !== undefined ? opts.icon : b.dataset.icon;
      const l = opts.label !== undefined ? opts.label : b.dataset.label;
      b.dataset.icon = i || "";
      b.dataset.label = l || "";
      b.innerHTML = (i ? BA_ICONS[i] : "") + (l ? "<span></span>" : "");
      if (l) b.lastElementChild.textContent = l;
      b.classList.toggle("ba-icon-only", !l);
    }
    if (opts.title !== undefined) b.title = opts.title;
    if (opts.disabled !== undefined) b.disabled = opts.disabled;
  };
  b.set({ icon, label, title: title || label || "" });
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

function uiProgress(parent) {
  const row = baEl("div", "ba-row");
  const track = baEl("div", "ba-track");
  const fill = baEl("div", "ba-fill");
  const time = baEl("span", "ba-time");
  track.append(fill);
  row.append(track, time);
  parent.append(row);
  const api = {
    row,
    set(current, total) {
      fill.style.width = (total > 0 ? Math.min(100, (100 * current) / total) : 0) + "%";
      time.textContent = fmtTime(current) + " / " + fmtTime(total);
    },
  };
  api.set(0, 0);
  return api;
}

function uiMeter(parent) {
  const track = baEl("div", "ba-track ba-meter");
  const fill = baEl("div", "ba-fill");
  track.append(fill);
  parent.append(track);
  return {
    el: track,
    set(level) {
      // ~60 dB range.
      const db = 20 * Math.log10(Math.max(level, 1e-6));
      fill.style.width = Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) + "%";
    },
  };
}

function uiSegmented(parent, options, value, onChange) {
  const seg = baEl("div", "ba-seg");
  seg.setAttribute("role", "group");
  const buttons = options.map(({ value: v, label, title }) => {
    const b = baEl("button");
    b.type = "button";
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener("click", () => onChange(v));
    b.dataset.value = v;
    seg.append(b);
    return b;
  });
  parent.append(seg);
  const api = {
    el: seg,
    set(v) {
      buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === v)));
    },
  };
  api.set(value);
  return api;
}

// Mini piano lighting the sounding notes.
function uiPiano(parent, lo = 21, hi = 108) {
  const piano = baEl("div", "ba-piano");
  const keys = new Map();
  const whites = [];
  for (let m = lo; m <= hi; m++) if (!BLACK.has(m % 12)) whites.push(m);
  const w = 100 / whites.length;
  whites.forEach((m) => {
    const k = baEl("div", "w");
    keys.set(m, k);
    piano.append(k);
  });
  for (let m = lo; m <= hi; m++) {
    if (!BLACK.has(m % 12)) continue;
    const k = baEl("div", "b");
    const left = whites.indexOf(m - 1) + 1; // the white key to its right
    k.style.left = left * w - w * 0.32 + "%";
    k.style.width = w * 0.64 + "%";
    keys.set(m, k);
    piano.append(k);
  }
  parent.append(piano);
  const count = new Map();
  return {
    el: piano,
    down(midi) {
      const k = keys.get(midi);
      if (!k) return;
      count.set(midi, (count.get(midi) || 0) + 1);
      k.classList.add("on");
    },
    up(midi) {
      const k = keys.get(midi);
      if (!k) return;
      const n = (count.get(midi) || 1) - 1;
      count.set(midi, n);
      if (n <= 0) k.classList.remove("on");
    },
    clear() {
      count.clear();
      keys.forEach((k) => k.classList.remove("on"));
    },
  };
}

// Play / Stop + progress for an AudioBuffer from makeBuffer(ctx).
function uiPlayback(parent, { makeBuffer, onChange, onBlocked, buttonParent, secondary }) {
  const row = baEl("div", "ba-row");
  parent.append(row);
  const button = uiButton({ icon: "play", label: "Play", secondary });
  (buttonParent || row).append(button);
  const progress = uiProgress(row);
  row.append(progress.row);
  progress.row.style.flex = "1";
  let ctx = null;
  let source = null;
  let gain = null; // per-playback gain: short fades instead of clicks
  let t0 = 0;
  let duration = 0;
  let raf = 0;

  const tick = () => {
    if (!source) return;
    progress.set(Math.min(ctx.currentTime - t0, duration), duration);
    raf = requestAnimationFrame(tick);
  };

  function stop(report = true) {
    const was = source;
    source = null;
    cancelAnimationFrame(raf);
    if (was) {
      // Fade out, then stop.
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, 0.006);
      try {
        was.stop(now + 0.05);
      } catch (e) {
        /* already ended */
      }
    }
    button.set({ icon: "play", label: "Play" });
    progress.set(0, duration);
    if (was && report && onChange) onChange(false);
  }

  function play() {
    stop(false);
    if (!ctx) ctx = newAudioContext();
    if (ctx.state !== "running") ctx.resume();
    const buffer = makeBuffer(ctx);
    if (!buffer) return false;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    gain = ctx.createGain();
    t0 = ctx.currentTime;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(1, t0 + 0.005); // 5 ms fade-in
    src.connect(gain).connect(ctx.destination);
    duration = buffer.duration;
    src.onended = () => {
      if (source === src) stop();
    };
    source = src;
    src.start();
    button.set({ icon: "stop", label: "Stop" });
    tick();
    if (onChange) onChange(true);
    // Autoplay may leave the context suspended.
    setTimeout(() => {
      if (source === src && ctx.state !== "running") {
        stop();
        if (onBlocked) onBlocked();
      }
    }, 250);
    return true;
  }

  button.addEventListener("click", () => (source ? stop() : play()));
  return {
    row,
    play,
    stop,
    get playing() {
      return source !== null;
    },
    setDuration(seconds) {
      duration = seconds;
      if (!source) progress.set(0, duration);
    },
    destroy() {
      stop(false);
      if (ctx) ctx.close();
    },
  };
}

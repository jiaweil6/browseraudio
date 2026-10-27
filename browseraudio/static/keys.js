// keys.js — the computer-keyboard control surface shared by keyboard.js and
// stream.js. Not a module of its own: Python prepends it to each widget's
// source (see `_bundle()` in _keyboard.py), so its functions are in scope there.
//
// Keys map to notes through a small state machine synced from Python
// (`keymap`): pressing keys[i] looks up table[state][i] -> [midi, next], calls
// onNoteOn(midi) (unless midi is null), then moves to state `next`. Releasing
// the key calls onNoteOff with whatever onNoteOn returned. Uses
// KeyboardEvent.code, so the physical layout is the same on QWERTY, AZERTY, ...

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const BLACK = new Set([1, 3, 6, 8, 10]);
const PUNCT = {
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-",
  Equal: "=", Backquote: "`", Space: "␣",
};

const KEYS_STYLE = `
.ba-kb { font: 13px/1.4 var(--jp-ui-font-family, system-ui, sans-serif);
  border: 1px solid var(--jp-border-color1, #ccc); border-radius: 6px;
  padding: 8px; outline: none; user-select: none; -webkit-user-select: none;
  background: var(--jp-layout-color1, #fff); color: var(--jp-ui-font-color1, #222); }
.ba-kb:focus-within { border-color: var(--jp-brand-color1, #1976d2);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--jp-brand-color1, #1976d2) 25%, transparent); }
.ba-kb-status { margin-bottom: 6px; opacity: 0.8; }
.ba-kb-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 6px; }
.ba-kb-bar button { font: inherit; padding: 2px 10px; cursor: pointer; }
.ba-kb-stats { font-family: var(--jp-code-font-family, ui-monospace, monospace); font-size: 12px; opacity: 0.85; }
.ba-kb-error { color: var(--jp-error-color1, #c62828); white-space: pre-wrap; }
.ba-kb-keys { display: flex; flex-wrap: wrap; gap: 3px; align-items: flex-start; }
.ba-kb-key { min-width: 34px; height: 64px; padding: 4px 2px; box-sizing: border-box;
  display: flex; flex-direction: column; justify-content: space-between; align-items: center;
  border: 1px solid var(--jp-border-color1, #bbb); border-radius: 4px; cursor: pointer;
  background: #fafafa; color: #222; touch-action: none; }
.ba-kb-key.black { background: #2b2b2b; color: #eee; height: 48px; }
.ba-kb-key.ctl { background: transparent; color: inherit; height: 40px; border-style: dashed; }
.ba-kb-key.down { background: var(--jp-brand-color1, #1976d2); color: #fff; }
.ba-kb-key b { font-size: 14px; }
.ba-kb-key small { font-size: 10px; opacity: 0.75; }
`;

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

const keyLabel = (code) =>
  code.startsWith("Key") ? code.slice(3)
  : code.startsWith("Digit") ? code.slice(5)
  : PUNCT[code] || code;

const noteName = (midi) => NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// Build the focusable keyboard panel into `el`. Returns { root, keysRow,
// liftAll, destroy }; callers may insert their own controls before keysRow.
function createKeys(model, el, { onNoteOn, onNoteOff, onFocus }) {
  const style = document.createElement("style");
  style.textContent = KEYS_STYLE;
  const root = document.createElement("div");
  root.className = "ba-kb";
  root.tabIndex = 0; // focusable: key events go to the focused widget only
  // JupyterLab: keep our key presses from firing notebook shortcuts.
  root.dataset.lmSuppressShortcuts = "true";
  const status = document.createElement("div");
  status.className = "ba-kb-status";
  const keysRow = document.createElement("div");
  keysRow.className = "ba-kb-keys";
  root.append(status, keysRow);
  el.append(style, root);

  let keymap, codeIndex, state, tiles;
  const held = new Map(); // key index -> onNoteOn's return (null: no note)

  const setStatus = () => {
    status.textContent = root.contains(document.activeElement)
      ? "● listening — play with your computer keyboard"
      : "Click here, then play with your computer keyboard";
  };

  function press(idx) {
    if (held.has(idx)) return; // already down (auto-repeat, or key + pointer)
    const [midi, next] = keymap.table[state][idx];
    state = next;
    held.set(idx, midi === null ? null : onNoteOn(midi));
    labelTiles();
  }

  function lift(idx) {
    if (!held.has(idx)) return;
    const handle = held.get(idx);
    held.delete(idx);
    tiles[idx].classList.remove("down");
    if (handle !== null && handle !== undefined) onNoteOff(handle);
  }

  function liftAll() {
    for (const idx of Array.from(held.keys())) lift(idx);
  }

  function labelTiles() {
    keymap.keys.forEach((code, i) => {
      const [midi, next] = keymap.table[state][i];
      const tile = tiles[i];
      tile.className = "ba-kb-key" + (held.has(i) ? " down" : "");
      let text;
      if (midi === null) {
        tile.classList.add("ctl");
        text = next < state ? "oct −" : next > state ? "oct +" : "·";
      } else {
        if (BLACK.has(midi % 12)) tile.classList.add("black");
        text = noteName(midi);
      }
      tile.querySelector("small").textContent = text;
    });
  }

  function buildKeys() {
    liftAll();
    keymap = model.get("keymap");
    codeIndex = new Map(keymap.keys.map((code, i) => [code, i]));
    state = keymap.start;
    tiles = keymap.keys.map((code, i) => {
      const tile = document.createElement("div");
      const label = document.createElement("b");
      label.textContent = keyLabel(code);
      tile.append(label, document.createElement("small"));
      tile.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        root.focus();
        tile.setPointerCapture(e.pointerId);
        press(i);
      });
      const up = () => lift(i);
      tile.addEventListener("pointerup", up);
      tile.addEventListener("pointercancel", up);
      return tile;
    });
    keysRow.replaceChildren(...tiles);
    labelTiles();
  }

  const isPlayKey = (e) =>
    codeIndex.has(e.code) && !e.metaKey && !e.ctrlKey && !e.altKey;

  root.addEventListener("keydown", (e) => {
    if (!isPlayKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) press(codeIndex.get(e.code));
  });
  root.addEventListener("keyup", (e) => {
    if (!codeIndex.has(e.code)) return;
    e.preventDefault();
    e.stopPropagation();
    lift(codeIndex.get(e.code));
  });
  root.addEventListener("focusin", () => {
    if (onFocus) onFocus();
    setStatus();
  });
  // No stuck notes: a key released while we weren't focused never reaches us.
  root.addEventListener("focusout", (e) => {
    if (root.contains(e.relatedTarget)) return; // focus moved within the widget
    liftAll();
    setStatus();
  });
  const onHidden = () => {
    if (document.hidden) liftAll();
  };
  document.addEventListener("visibilitychange", onHidden);
  model.on("change:keymap", buildKeys);

  buildKeys();
  setStatus();

  return {
    root,
    keysRow,
    liftAll,
    destroy() {
      liftAll();
      document.removeEventListener("visibilitychange", onHidden);
    },
  };
}

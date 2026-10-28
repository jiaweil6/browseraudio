// controls.js — Keys (musical typing via `keymap`) and Genie (8 buttons, Piano
// Genie) input for Keyboard and Stream: onNoteOn(midi) -> handle, onNoteOff(handle).

const PUNCT = {
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-",
  Equal: "=", Backquote: "`", Space: "␣",
};
const keyLabel = (code) =>
  code.startsWith("Key") ? code.slice(3)
  : code.startsWith("Digit") ? code.slice(5)
  : PUNCT[code] || code;

// Genie buttons: number row or home row.
const GENIE_CODES = [
  ["Digit1", "KeyA"], ["Digit2", "KeyS"], ["Digit3", "KeyD"], ["Digit4", "KeyF"],
  ["Digit5", "KeyJ"], ["Digit6", "KeyK"], ["Digit7", "KeyL"], ["Digit8", "Semicolon"],
];

function createControls(model, ui, { onNoteOn, onNoteOff, onFocus, onBlur, genieKeys }) {
  const root = ui.root;
  root.tabIndex = 0; // focusable: key events go to the focused widget only
  const surface = baEl("div");
  const hint = baEl("div", "ba-hint");
  ui.body.append(surface);
  const piano = uiPiano(ui.body);
  ui.body.append(hint);
  const seg = uiSegmented(
    ui.actions,
    [
      { value: "keys", label: "Keys", title: "Musical typing: A W S E D F … play notes, Z / X shift the octave" },
      { value: "genie", label: "Genie", title: "Genie mode (Piano Genie): 8 buttons, 1–8 or A S D F J K L ;" },
    ],
    model.get("input"),
    (value) => {
      if (model.get("input") === value) return;
      model.set("input", value);
      model.save_changes();
    },
  );
  ui.actions.prepend(seg.el);

  const mode = () => model.get("input");
  const held = new Map(); // "k3" / "g5" -> { midi, handle }
  let keymap, state, tiles, codeIndex;
  let pads = [];
  let genie = null;
  let genieLoading = null;

  function noteOn(id, midi) {
    if (held.has(id)) return; // already down (auto-repeat, or key + pointer)
    const handle = onNoteOn(midi);
    held.set(id, { midi, handle });
    piano.down(midi);
  }

  function noteOff(id) {
    const note = held.get(id);
    if (!note) return;
    held.delete(id);
    piano.up(note.midi);
    if (note.handle !== null && note.handle !== undefined) onNoteOff(note.handle);
  }

  function liftAll() {
    for (const id of Array.from(held.keys())) noteOff(id);
    tiles && tiles.forEach((t) => t.classList.remove("down"));
    pads.forEach((p) => p.classList.remove("down"));
  }

  function pressKey(i) {
    if (held.has("k" + i)) return;
    const [midi, next] = keymap.table[state][i];
    state = next;
    if (midi === null) held.set("k" + i, { midi: null, handle: null });
    else noteOn("k" + i, midi);
    labelTiles();
  }

  function liftKey(i) {
    const note = held.get("k" + i);
    if (note && note.midi === null) held.delete("k" + i);
    else noteOff("k" + i);
    if (tiles[i]) tiles[i].classList.remove("down");
  }

  function labelTiles() {
    keymap.keys.forEach((code, i) => {
      const [midi, next] = keymap.table[state][i];
      const tile = tiles[i];
      tile.className = "ba-tile" + (held.has("k" + i) ? " down" : "");
      let text;
      if (keymap.labels) {
        text = keymap.labels[i]; // named pads (e.g. drums): no piano colouring
      } else if (midi === null) {
        tile.classList.add("ctl");
        text = next < state ? "oct−" : next > state ? "oct+" : "·";
      } else {
        if (BLACK.has(midi % 12)) tile.classList.add("black");
        text = noteName(midi);
      }
      tile.lastElementChild.textContent = text;
    });
  }

  function buildKeys() {
    keymap = model.get("keymap");
    state = keymap.start;
    codeIndex = new Map(keymap.keys.map((code, i) => [code, i]));
    tiles = keymap.keys.map((code, i) => {
      const tile = baEl("div", "ba-tile");
      const label = baEl("b");
      label.textContent = keyLabel(code);
      tile.append(label, baEl("small"));
      pointerPlay(tile, () => pressKey(i), () => liftKey(i));
      return tile;
    });
    const row = baEl("div", "ba-tiles");
    row.append(...tiles);
    surface.replaceChildren(row);
    labelTiles();
    hint.innerHTML = keymap.labels
      ? "Click here, then play the keys shown."
      : "Click here, then play: <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> … white keys, " +
        "<kbd>W</kbd> <kbd>E</kbd> <kbd>T</kbd> … black keys, <kbd>Z</kbd> / <kbd>X</kbd> octave.";
  }

  function loadGenie() {
    if (genie || genieLoading) return genieLoading;
    ui.note("Loading the Piano Genie model (1.2 MB)…", "info");
    genieLoading = Genie.load(model.get("genie_checkpoint"))
      .then((g) => {
        genie = g;
        ui.note("");
      })
      .catch((err) => {
        ui.note("Couldn't load the Piano Genie model (" + err.message + ") — back to Keys.");
        model.set("input", "keys");
        model.save_changes();
      })
      .finally(() => {
        genieLoading = null;
      });
    return genieLoading;
  }

  function pressPad(b) {
    if (held.has("g" + b)) return;
    pads[b].classList.add("down");
    if (!genie) {
      loadGenie();
      return;
    }
    const keys = genieKeys ? genieKeys() : null;
    const key = genie.next(b, { temperature: model.get("genie_temperature"), keys });
    noteOn("g" + b, key + GENIE_LOWEST_MIDI);
  }

  function liftPad(b) {
    pads[b].classList.remove("down");
    noteOff("g" + b);
  }

  function buildGenie() {
    pads = GENIE_CODES.map(([digit, home], b) => {
      const pad = baEl("button", "ba-pad");
      pad.type = "button";
      pad.style.setProperty("--h", String(Math.round(b * 41 + 205) % 360));
      pad.innerHTML = `<b>${b + 1}</b><small>${keyLabel(home)}</small>`;
      pad.tabIndex = -1;
      pointerPlay(pad, () => pressPad(b), () => liftPad(b));
      return pad;
    });
    const grid = baEl("div", "ba-pads");
    grid.append(...pads);
    surface.replaceChildren(grid);
    hint.innerHTML = "Click here, then play <kbd>1</kbd>–<kbd>8</kbd> (or <kbd>A</kbd> <kbd>S</kbd> " +
      "<kbd>D</kbd> <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd> <kbd>;</kbd>): low buttons " +
      "play lower, high ones higher — the genie picks the notes.";
    loadGenie();
  }

  function pointerPlay(node, down, up) {
    node.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      root.focus();
      node.setPointerCapture(e.pointerId);
      down();
    });
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  }

  function build() {
    liftAll();
    piano.clear();
    seg.set(mode());
    if (mode() === "genie") {
      buildGenie();
      ui.credit(BA_GENIE_CREDIT);
    } else {
      buildKeys();
      ui.credit("");
    }
  }

  function codeFor(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return null;
    if (mode() === "genie") {
      const b = GENIE_CODES.findIndex((pair) => pair.includes(e.code));
      return b < 0 ? null : { press: () => pressPad(b), lift: () => liftPad(b) };
    }
    const i = codeIndex.get(e.code);
    return i === undefined ? null : { press: () => pressKey(i), lift: () => liftKey(i) };
  }

  root.addEventListener("keydown", (e) => {
    const action = codeFor(e);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) action.press();
  });
  root.addEventListener("keyup", (e) => {
    const action = codeFor(e);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    action.lift();
  });
  const setListening = () => root.classList.toggle("ba-listening", ui.hasFocus());
  root.addEventListener("focusin", (e) => {
    // The header's buttons (Stop, Keys | Genie) don't start audio.
    if (onFocus && !ui.actions.contains(e.target)) onFocus();
    setListening();
  });
  // Release everything when focus leaves (key-ups won't reach us).
  root.addEventListener("focusout", (e) => {
    if (root.contains(e.relatedTarget)) return;
    liftAll();
    setListening();
    if (onBlur) onBlur();
  });
  const onHidden = () => {
    if (document.hidden) liftAll();
  };
  document.addEventListener("visibilitychange", onHidden);
  model.on("change:input", build);
  model.on("change:keymap", () => {
    if (mode() === "keys") build();
  });

  build();

  return {
    piano,
    liftAll,
    listening: () => ui.hasFocus(),
    destroy() {
      liftAll();
      document.removeEventListener("visibilitychange", onHidden);
    },
  };
}

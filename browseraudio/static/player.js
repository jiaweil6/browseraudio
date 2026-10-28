// player.js — Player frontend: plays planar float32 PCM; Play/Stop from the button or Python.

function render({ model, el }) {
  const ui = mountUI(el, "Player");

  // AudioContext resamples, so any sample_rate works.
  function buildBuffer(ctx) {
    if (!model.get("_pcm_b64")) {
      ui.note("Nothing to play.", "info");
      return null;
    }
    const sr = model.get("sample_rate");
    const nch = Math.max(1, model.get("n_channels"));
    const planar = fromBase64(model.get("_pcm_b64"));
    const frames = Math.floor(planar.length / nch);
    const buffer = ctx.createBuffer(nch, frames, sr);
    for (let c = 0; c < nch; c++) {
      buffer.copyToChannel(planar.subarray(c * frames, (c + 1) * frames), c);
    }
    return buffer;
  }

  const playback = uiPlayback(ui.body, {
    makeBuffer: buildBuffer,
    buttonParent: ui.actions,
    onChange: (playing) => {
      ui.status(playing ? "live" : "ready", playing ? "playing" : "ready");
      if (playing) ui.note("");
      if (model.get("playing") !== playing) {
        model.set("playing", playing);
        model.save_changes();
      }
    },
    onBlocked: () => {
      ui.status("ready", "ready");
      ui.note("The browser blocked autoplay — press Play.", "info");
    },
  });

  function describe() {
    const sr = model.get("sample_rate");
    const nch = Math.max(1, model.get("n_channels"));
    const b64 = model.get("_pcm_b64");
    // Frame count from the base64 length.
    const frames = Math.floor((b64.length * 3) / 4 / 4 / nch);
    const seconds = sr ? frames / sr : 0;
    playback.setDuration(seconds);
    ui.stats(
      (nch === 1 ? "mono" : nch === 2 ? "stereo" : nch + " ch") + " · " +
      (sr / 1000).toFixed(sr % 1000 ? 1 : 0) + " kHz · " + seconds.toFixed(2) + " s",
    );
  }
  describe();
  ui.status("ready", "ready");
  model.on("change:_pcm_b64 change:sample_rate change:n_channels", describe);

  // Python's play() / stop().
  model.on("change:playing", () => {
    const want = model.get("playing");
    if (want && !playback.playing) playback.play();
    else if (!want && playback.playing) playback.stop();
  });

  if (model.get("autoplay") || model.get("playing")) playback.play();

  return () => {
    playback.destroy();
    ui.destroy();
  };
}

export default { render };

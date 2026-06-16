// player.js — anywidget frontend for browseraudio.Player.
//
// Runs on the MAIN thread, where the Web Audio API lives. The Python kernel
// that drives this widget may be in a Web Worker (JupyterLite / thebe-lite),
// which has no access to AudioContext — so Python ships the samples here
// (channel-major float32 PCM, base64 over the widget comm) and playback
// happens on this thread.
//
// Playback is fire-and-forget: nothing has to return to the kernel, so unlike
// recording it works in a single cell. Browsers block audio that starts
// without a user gesture, so we attempt autoplay and always leave a Play
// button as the fallback.

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

async function render({ model, el }) {
  const button = document.createElement("button");
  button.className = "jupyter-button";
  const status = document.createElement("span");
  status.style.marginLeft = "0.5em";
  el.append(button, status);

  let ctx;
  let source; // the currently-playing buffer source, if any

  // Build an AudioBuffer from the planar PCM. AudioContext resamples to its
  // own rate on playback, so an arbitrary sample_rate is fine.
  function buildBuffer() {
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

  async function play() {
    if (!model.get("_pcm_b64")) {
      status.textContent = "nothing to play";
      return;
    }
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioCtx();
    }
    await ctx.resume(); // throws / stays suspended if there was no user gesture
    if (source) {
      try {
        source.stop();
      } catch (e) {
        /* already stopped */
      }
    }
    source = ctx.createBufferSource();
    source.buffer = buildBuffer();
    source.connect(ctx.destination);
    source.onended = () => {
      status.textContent = "";
      button.textContent = "▶ Play";
    };
    source.start();
    button.textContent = "▶ Replay";
    status.textContent = "playing…";
  }

  button.textContent = "▶ Play";
  button.addEventListener("click", () => play().catch((err) => {
    status.textContent = "error: " + err;
  }));

  if (model.get("autoplay")) {
    // May be refused by the browser's autoplay policy — that's fine, the
    // button still works. Swallow the rejection rather than show an error.
    play().catch(() => {
      status.textContent = "click ▶ to play";
    });
  }
}

export default { render };

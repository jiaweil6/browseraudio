// recorder.js — anywidget frontend for browseraudio.Recorder.
//
// Runs on the MAIN thread, where the Web Audio API and getUserMedia live.
// The Python kernel that drives this widget may be in a Web Worker
// (JupyterLite / thebe-lite), which has no access to those APIs — so the
// capture happens here and the samples are handed back to Python over the
// widget comm channel (base64-encoded float32 PCM).
//
// v0 uses ScriptProcessorNode: deprecated but universally supported and
// dependency-free. A future version should move to an AudioWorklet.

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000; // chunk to stay under the argument-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function render({ model, el }) {
  const button = document.createElement("button");
  button.className = "jupyter-button";
  const status = document.createElement("span");
  status.style.marginLeft = "0.5em";

  const label = () => "● Record " + model.get("duration") + "s";
  button.textContent = label();
  model.on("change:duration", () => (button.textContent = label()));
  el.append(button, status);

  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "recording…";
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      await ctx.resume();
      const sampleRate = ctx.sampleRate;
      const duration = model.get("duration");

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const chunks = [];
      let total = 0;

      await new Promise((resolve) => {
        processor.onaudioprocess = (event) => {
          const input = event.inputBuffer.getChannelData(0);
          chunks.push(new Float32Array(input));
          total += input.length;
          if (total >= duration * sampleRate) resolve();
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        setTimeout(resolve, (duration + 1.5) * 1000); // safety: never hang
      });

      processor.disconnect();
      source.disconnect();
      ctx.close();

      const pcm = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        pcm.set(chunk, offset);
        offset += chunk.length;
      }

      model.set("sample_rate", sampleRate);
      model.set("_pcm_b64", total ? toBase64(pcm.buffer) : "");
      if (!total) model.set("_error", "no audio was captured");
      model.save_changes();
      status.textContent = "recorded " + (total / sampleRate).toFixed(2) + "s";
    } catch (err) {
      model.set("_error", String(err));
      model.save_changes();
      status.textContent = "error: " + err;
    } finally {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      button.disabled = false;
    }
  });
}

export default { render };

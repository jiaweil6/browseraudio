// recorder.js — anywidget frontend for browseraudio.Recorder.
//
// Runs on the MAIN thread, where the Web Audio API and getUserMedia live.
// The Python kernel that drives this widget may be in a Web Worker
// (JupyterLite / thebe-lite), which has no access to those APIs — so the
// capture happens here and the samples are handed back to Python over the
// widget comm channel (base64-encoded float32 PCM). After capturing, an
// inline <audio> player is shown so the user can hear the take immediately.
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

// Encode float32 [-1, 1] mono samples as a 16-bit PCM WAV blob (for the
// inline preview player only; Python receives the full-precision float32).
function wavBlob(samples, sampleRate) {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, n * 2, true);
  let offset = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function render({ model, el }) {
  const button = document.createElement("button");
  button.className = "jupyter-button";
  const status = document.createElement("span");
  status.style.marginLeft = "0.5em";
  const player = document.createElement("div"); // holds the inline preview
  player.style.marginTop = "0.5em";

  const label = () => "● Record " + model.get("duration") + "s";
  button.textContent = label();
  model.on("change:duration", () => (button.textContent = label()));
  el.append(button, status, player);

  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "recording…";
    player.replaceChildren();
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

      if (total) {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.src = URL.createObjectURL(wavBlob(pcm, sampleRate));
        player.append(audio);
      }
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

// recorder.js — Recorder frontend: mic capture (ScriptProcessorNode), stop early,
// preview; samples go to Python as base64 float32.

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000; // chunk to stay under the argument-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function render({ model, el }) {
  const ui = mountUI(el, "Recorder");
  const button = uiButton({ icon: "record", label: "Record" });
  ui.actions.append(button);
  const live = baEl("div", "ba-row");
  const meter = uiMeter(live);
  ui.body.append(live);
  const progress = uiProgress(ui.body);
  let take = null; // { pcm, sampleRate } of the latest recording
  const preview = uiPlayback(ui.body, {
    secondary: true,
    makeBuffer: (ctx) => {
      if (!take) return null;
      const buffer = ctx.createBuffer(1, take.pcm.length, take.sampleRate);
      buffer.copyToChannel(take.pcm, 0);
      return buffer;
    },
  });
  live.style.display = "none";
  preview.row.style.display = "none";
  const showCapture = (on) => {
    live.style.display = on ? "" : "none";
    progress.row.style.display = on || !take ? "" : "none";
  };

  let recording = false;
  let stopRequested = false;
  let stopEarly = null; // ends the capture now, keeping what was recorded

  const label = () => "Record " + model.get("duration") + " s";
  function idle(text) {
    button.set({ icon: "record", label: label() });
    ui.status(take ? "ready" : "idle", text || (take ? "recorded" : "ready"));
  }
  model.on("change:duration", () => {
    if (!recording) idle();
    progress.set(0, model.get("duration"));
  });
  progress.set(0, model.get("duration"));
  idle();

  async function record() {
    recording = true;
    stopRequested = false;
    preview.stop(false);
    preview.row.style.display = "none";
    showCapture(true);
    ui.note("");
    button.set({ icon: "stop", label: "Stop" });
    ui.status("load", "waiting for the microphone…");
    let stream;
    let ctx;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      ctx = newAudioContext();
      await ctx.resume();
      const sampleRate = ctx.sampleRate;
      const duration = model.get("duration");
      const target = Math.round(duration * sampleRate);

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const chunks = [];
      let total = 0;
      ui.status("rec", "recording");

      await new Promise((resolve) => {
        const safety = setTimeout(resolve, (duration + 1.5) * 1000); // never hang
        processor.onaudioprocess = (event) => {
          if (stopRequested || total >= target) return;
          const input = event.inputBuffer.getChannelData(0);
          chunks.push(new Float32Array(input));
          total += input.length;
          let sum = 0;
          for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
          meter.set(Math.sqrt(sum / input.length));
          progress.set(Math.min(total, target) / sampleRate, duration);
          if (total >= target) {
            clearTimeout(safety);
            resolve();
          }
        };
        stopEarly = () => {
          clearTimeout(safety);
          resolve();
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        if (stopRequested) stopEarly(); // Stop pressed during the permission prompt
      });

      processor.disconnect();
      source.disconnect();

      // Trim to the requested length (or what was captured).
      const length = Math.min(total, target);
      const pcm = new Float32Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        if (offset >= length) break;
        pcm.set(chunk.subarray(0, length - offset), offset);
        offset += chunk.length;
      }

      model.set("sample_rate", sampleRate);
      model.set("_pcm_b64", length ? toBase64(pcm.buffer) : "");
      if (!length) model.set("_error", "no audio was captured");
      model.save_changes();
      if (length) {
        take = { pcm, sampleRate };
        preview.setDuration(length / sampleRate);
        preview.row.style.display = "";
        idle("recorded " + (length / sampleRate).toFixed(2) + " s" + (stopRequested ? " (stopped early)" : ""));
      } else {
        idle();
        ui.note("No audio was captured.");
      }
    } catch (err) {
      model.set("_error", String(err));
      model.save_changes();
      idle();
      ui.status("error", "error");
      ui.note(String(err));
    } finally {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (ctx) ctx.close();
      stopEarly = null;
      recording = false;
      showCapture(false);
      meter.set(0);
    }
  }

  button.addEventListener("click", () => {
    if (!recording) {
      record();
    } else {
      stopRequested = true;
      if (stopEarly) stopEarly();
    }
  });

  return () => {
    stopRequested = true;
    if (stopEarly) stopEarly();
    preview.destroy();
    ui.destroy();
  };
}

export default { render };

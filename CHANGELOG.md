# Changelog

All notable changes to **browseraudio** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `stream(callback, sample_rate, block_size)` / `Stream` — real-time synthesis.
  The browser is the clock: an `AudioWorklet` plays a short queue of blocks and
  pulls each next one from a pyquist-style `callback(block)` running in the
  kernel, so it works in Web-Worker kernels (JupyterLite / thebe) too. Key
  presses on the widget call `on_note(midi, is_on)` right away; the widget shows
  block size, queue, kernel round trip, callback time budget, dropouts and the
  resulting key-to-sound latency. Blocks travel in batches, so tiny and huge
  block sizes both run.
- `browseraudio.sounddevice.OutputStream` — a callback-mode
  `sounddevice.OutputStream` built on `Stream`, with `CallbackStop`,
  `CallbackAbort` and `CallbackFlags` (browser dropouts arrive as
  `output_underflow`). Real-time `sounddevice` code, including course support
  modules with their own widgets, runs unchanged with the facade registered as
  `sounddevice`.
- `keyboard(render, sample_rate)` / `Keyboard` — a synth designed in NumPy ahead
  of time (a note bank or a looped wavetable with ADSR) and voiced entirely in
  the browser, with the performance logged back as `events` and re-rendered by
  `render()`.
- `KeyMap` — computer-key → MIDI mapping as a small state machine (musical
  typing by default, with octave keys; context-dependent mappings fit too).
- `demo/synth.html`.

### Changed
- `sounddevice.query_devices` resolves `(input, output)` pairs with `kind=`,
  name substrings and `kind`-only lookups, and the table prints like
  sounddevice's.
- The demo site installs the wheel built from its own commit (falling back to
  PyPI), so it can show unreleased features.

### Fixed
- CI: pin the test runner to Ubuntu 24.04, which still has Python 3.9.

## [0.3.0] — 2026-06-24

### Added
- `browseraudio.sounddevice` — a [`sounddevice`](https://python-sounddevice.readthedocs.io)-shaped
  facade (`play`, `wait`, `query_devices`, `default`) so libraries can fall back
  to it in the browser. Playback is genuinely drop-in; `rec` raises with
  guidance toward the two-cell `record()` flow, since a browser kernel can't
  fill a capture buffer synchronously (the AudioContext picks the rate, and a
  Web-Worker kernel can't process the comm reply mid-cell).
- `Recorder.on_result(cb)` / `Recorder.on_error(cb)` — public hooks to react to
  a completed (or failed) capture without observing the internal `_pcm_b64` /
  `_error` traits.
- `Recorder.result()` — an awaitable that resolves with the recorder once
  capture completes (main-thread kernels only); it detects Web-Worker kernels
  and raises immediately instead of hanging.
- `browseraudio._env` — `in_browser()` / `in_worker()` runtime detection.

## [0.2.0] — 2026-06-17

### Added
- `Player` — an [anywidget](https://anywidget.dev) that plays a NumPy audio
  buffer through the browser's `AudioContext` on the main thread, so playback
  works even when the kernel runs in a Web Worker (Pyodide / JupyterLite /
  thebe-lite). Multi-channel buffers are supported (sent channel-major), and
  the `AudioContext` resamples to its own rate, so any `sample_rate` is fine.
- `play(samples, sample_rate=None, *, autoplay=True)` — convenience function
  that displays a `Player` and returns it. A drop-in shape for
  `sounddevice.play` / `pyquist.play`; reads `sample_rate` from a
  `pyquist.Audio` when not given. Playback is fire-and-forget, so unlike
  recording it works in a single cell. Browsers may block autoplay without a
  user gesture; a **▶ Play** button is always available as a fallback.

## [0.1.2] — 2026-06-15

### Fixed
- A recording of `duration` seconds now returns exactly `round(duration *
  sample_rate)` samples. Previously it overshot by up to one capture block
  (~85 ms at 48 kHz), so `record(3.0)` produced ~3.07 s.

## [0.1.1] — 2026-06-14

### Changed
- Overhauled the README (contents TOC, requirements, full API reference,
  troubleshooting, and development sections) and added this changelog.
  Documentation only — no code changes.

## [0.1.0] — 2026-06-14

First public release.

### Added
- `Recorder` — an [anywidget](https://anywidget.dev) that captures microphone
  audio in the browser via the Web Audio API and returns it to the Python
  kernel as a NumPy float32 array (`(n_frames, 1)`), even when the kernel runs
  in a Web Worker (Pyodide / JupyterLite / thebe-lite), over the Jupyter widget
  comm channel.
- `record(duration=3.0)` — convenience function that displays a `Recorder` and
  returns it.
- Inline `<audio>` preview of each take, rendered in the widget.
- `Recorder.to_pyquist()` — convert a take to a `pyquist.Audio` (optional
  `pyquist` dependency, via the `browseraudio[pyquist]` extra).

### Known limitations
- Recording only (no playback yet).
- Requires a secure context (`https://` or `localhost`), a user gesture, and the
  microphone-permission prompt.
- Uses the deprecated `ScriptProcessorNode` and a base64 comm transport; both
  are slated to change (see the roadmap in the README).
- A single-cell `await record()` is not supported; use the two-cell flow.

[Unreleased]: https://github.com/jiaweil6/browseraudio/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/jiaweil6/browseraudio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jiaweil6/browseraudio/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/jiaweil6/browseraudio/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/jiaweil6/browseraudio/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/jiaweil6/browseraudio/releases/tag/v0.1.0

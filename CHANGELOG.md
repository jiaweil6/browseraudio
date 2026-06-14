# Changelog

All notable changes to **browseraudio** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

_Nothing yet._

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

[Unreleased]: https://github.com/jiaweil6/browseraudio/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/jiaweil6/browseraudio/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/jiaweil6/browseraudio/releases/tag/v0.1.0

# browseraudio demo

A small static site that demonstrates **browseraudio** — record from the mic and
play audio back — running entirely in the browser. No build step, no server, no
WebAssembly kernel to boot.

## Pages

One page per capability, so the site grows cleanly as more of the
`sounddevice`-shaped API lands:

| Page | What it shows |
|---|---|
| `index.html` | Landing — overview and links. |
| `record.html` | `record()` — captures the mic to a NumPy array. |
| `play.html` | `play()` — push a NumPy buffer to the speakers (tone + stereo). |
| `how-it-works.html` | The architecture: the anywidget bridge, the `sounddevice` facade, the real notebook stack (JupyterLite / Pyodide), and how the demo runs the real kernel. |

Both interactive pages (`record.html`, `play.html`) boot a **real** in-browser Python
kernel (thebe + Pyodide) and run the actual `browseraudio` package, just like
JupyterLite / thebe.

```
demo/
├── index.html  record.html  play.html  how-it-works.html
├── service-worker.js    # pyodide kernel's contents SW (root scope) — for Record
├── vendor-thebe.sh      # fetches the live-code runtime below
├── assets/
│   ├── style.css        # shared design system (light + dark)
│   ├── live.js          # boots the real thebe + Pyodide kernel; runs the cells
│   └── live.css         # styles thebe's CodeMirror editors to match the cells
└── vendor/
    └── thebe-dist/      # thebe 0.9.3 (core/) + thebe-lite 0.5.0 (lite/), from npm
```

## How the interactive cells work

`assets/live.js` boots a **real** in-browser Python kernel — thebe + thebe-lite +
Pyodide (vendored under `vendor/thebe-dist/`) — and `micropip`-installs the actual
`browseraudio` package from PyPI on the first Run. So `record(3.0)` runs the genuine
`Recorder` anywidget and `play(...)` the genuine `Player`, exactly as they would in
[JupyterLite](https://jupyterlite.readthedocs.io/) or
[thebe](https://thebe.readthedocs.io/). The runtime is a one-time ~25 MB download;
reload the page to reset. The cells are editable CodeMirror, styled to match via
`assets/live.css`.

See `how-it-works.html` for the full architecture.

## Run it locally

The microphone needs a **secure context**, so open it over `localhost` — not as a
`file://` URL:

```sh
cd demo
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy it

Any static host works (GitHub Pages, Netlify, S3, …) as long as it serves over
`https://`. Publish the whole `demo/` folder — everything is self-contained.

## Keeping the vendored runtime in sync

The demo runs the genuine package by `micropip`-installing `browseraudio` from PyPI
into the kernel, so there's no frontend copy to keep in sync — just the live-code
runtime under `vendor/thebe-dist/` (plus root `service-worker.js`), fetched by
`vendor-thebe.sh`. Run it once to populate, or to bump the pinned thebe / thebe-lite
versions:

```sh
./vendor-thebe.sh                       # idempotent; skips if already vendored
rm -rf vendor/thebe-dist && ./vendor-thebe.sh   # force a refetch
```

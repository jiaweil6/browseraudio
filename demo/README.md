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
| `record.html` | `record()` — capture the mic to a NumPy array. |
| `play.html` | `play()` — push a NumPy buffer to the speakers (tone + stereo). |
| `how-it-works.html` | The architecture: the anywidget bridge, the real notebook stack (JupyterLite / Pyodide), and how this demo runs without a kernel. |

```
demo/
├── index.html  record.html  play.html  how-it-works.html
├── assets/
│   ├── style.css     # shared design system (light + dark)
│   └── demo.js       # drives the library's frontend modules in-page
└── vendor/
    └── browseraudio/ # recorder.js + player.js, copied from the package
```

## How the interactive cells work

The demo doesn't run a Python kernel. Instead it loads browseraudio's **own
frontend modules** — `recorder.js` and `player.js`, copied verbatim from the
package's `static/` folder — and drives them with a tiny stand-in widget model
(`demo.js`). That's the same Web Audio code a real notebook runs; only the
round-trip to a Python kernel is omitted. The Python shown beside each cell is the
exact API you'd call in [JupyterLite](https://jupyterlite.readthedocs.io/) or
[thebe](https://thebe.readthedocs.io/). See `how-it-works.html` for the full story.

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

## Keeping the vendored frontend in sync

`vendor/browseraudio/*.js` are copies of the package's frontend. Refresh them if
the library's `static/` changes:

```sh
cp ../browseraudio/static/recorder.js vendor/browseraudio/recorder.js
cp ../browseraudio/static/player.js   vendor/browseraudio/player.js
```

# browseraudio demo

Static site, published to [GitHub Pages](https://jiaweil6.github.io/browseraudio/).
The interactive pages run the real package on a thebe-lite + Pyodide kernel
(`assets/live.js`; ~25 MB on the first Run).

| Page | Shows |
|---|---|
| `index.html` | Overview. |
| `record.html` | `record()`, then your voice as a keyboard instrument. |
| `play.html` | `play()`: a tone and a stereo beat. |
| `synth.html` | `keyboard()`: electric piano, wavetable, Karplus–Strong strings (genie mode), drum kit. |
| `realtime.html` | `stream()` / `OutputStream`: stateful sine, block size vs. latency, polyphonic synth, genie mode, FM, a de-zippered fader. |
| `how-it-works.html` | The architecture. |

## Run locally

The mic needs a secure context, so serve over `localhost`:

```sh
cd demo && python3 -m http.server 8000
```

This installs browseraudio from PyPI. To demo your working copy, build it first
(the deploy workflow does the same):

```sh
rm -rf demo/wheels && python -m build --wheel -o demo/wheels    # from the repo root
(cd demo/wheels && echo "{\"wheel\": \"$(ls *.whl)\"}" > manifest.json)
```

## Vendored runtime

`vendor/thebe-dist/` (thebe 0.9.3 + thebe-lite 0.5.0) and `service-worker.js` come
from `./vendor-thebe.sh`; delete `vendor/thebe-dist` and rerun it to refetch.

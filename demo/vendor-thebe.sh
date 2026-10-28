#!/usr/bin/env bash
# vendor-thebe.sh — vendor thebe 0.9.3 + thebe-lite 0.5.0 (as icmbook does) for the
# live demo pages. Idempotent: skips if already vendored.
set -euo pipefail

cd "$(dirname "$0")"
DIST="vendor/thebe-dist"

if [ -f "$DIST/.ok" ]; then
  echo "thebe stack already vendored ($DIST). Delete $DIST/.ok to refetch."
  exit 0
fi

echo "Fetching thebe-lite 0.5.0 + thebe 0.9.3 from npm…"
rm -rf "$DIST"
mkdir -p "$DIST/tmp1" "$DIST/tmp2"
curl -sL https://registry.npmjs.org/thebe-lite/-/thebe-lite-0.5.0.tgz | tar xz -C "$DIST/tmp1"
curl -sL https://registry.npmjs.org/thebe/-/thebe-0.9.3.tgz | tar xz -C "$DIST/tmp2"
mv "$DIST/tmp1/package/dist/lib" "$DIST/lite"
mv "$DIST/tmp2/package/lib" "$DIST/core"
rm -rf "$DIST/tmp1" "$DIST/tmp2" "$DIST"/lite/*.map "$DIST"/core/*.map
# The pyodide kernel's contents service worker must be served from the site
# root for root scope, so keep a copy there too.
cp "$DIST/lite/service-worker.js" service-worker.js
touch "$DIST/.ok"
echo "Done — vendored into $DIST and ./service-worker.js"

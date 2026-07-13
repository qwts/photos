#!/bin/sh
# Regenerates the committed build/ icon set from the design handoff package
# (#236). macOS-only (iconutil); requires ImageMagick (`brew install
# imagemagick`). Outputs are committed so CI never needs these tools.
set -eu

cd "$(dirname "$0")/.."
ICONSET="design/handoff/assets/Overlook.iconset"
PNGSET="design/handoff/assets/icon-set"

mkdir -p build
iconutil -c icns "$ICONSET" -o build/icon.icns
magick "$PNGSET/overlook-16.png" "$PNGSET/overlook-32.png" \
  "$PNGSET/overlook-64.png" "$PNGSET/overlook-128.png" \
  "$PNGSET/overlook-256.png" build/icon.ico
cp "$PNGSET/overlook-512.png" build/icon.png
cp design/handoff/assets/overlook-icon-64.png src/renderer/src/assets/overlook-icon-64.png

echo "Regenerated build/icon.{icns,ico,png} + renderer wordmark asset."

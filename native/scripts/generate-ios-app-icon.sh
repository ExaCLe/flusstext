#!/bin/sh
# Renders the iOS app icon master (1024x1024, opaque RGB, no alpha) from its vector source.
# Requires rsvg-convert (librsvg) and ImageMagick: brew install librsvg imagemagick
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
src="$here/assets/icon/ios-app-icon.svg"
out="$here/ios/FlusstextNative/Images.xcassets/AppIcon.appiconset/icon1024.png"
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
tmp="$tmpdir/icon.png"
rsvg-convert --width 1024 --height 1024 --background-color '#141517' "$src" -o "$tmp"
# Strip ancillary metadata and write 8-bit RGB for deterministic output without an alpha channel.
magick "$tmp" -alpha off -strip -define png:color-type=2 -define png:bit-depth=8 "PNG24:$out"
echo "wrote $out"

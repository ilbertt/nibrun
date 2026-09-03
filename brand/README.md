# brand

`logo.svg` is the source. Each app's `public/favicon.svg` is a symlink to it, and
`packages/ui`'s `NibrunMark` redraws the same artwork as JSX — change one and change
all three.

The rasters are generated, not edited. To regenerate them after `logo.svg` changes:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --hide-scrollbars --force-device-scale-factor=1 --window-size=1024,1024 \
  --screenshot=/tmp/logo-1024.png "file://$PWD/logo.svg"
magick /tmp/logo-1024.png -strip -define png:compression-level=9 logo-1024.png
for s in 512 256 128 64 32; do
  magick /tmp/logo-1024.png -filter Lanczos -resize ${s}x${s} \
    -strip -define png:compression-level=9 logo-$s.png
done
```

Chrome rather than ImageMagick's own SVG renderer, which drops the gradient.

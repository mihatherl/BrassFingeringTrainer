# Third-party notices

This application bundles material from two other projects. Both are used under
licences that permit commercial use; both require attribution, which is given
here, in the README, and on the app's own settings screen.

## Bravura — music notation glyphs

Copyright © 2019 Steinberg Media Technologies GmbH, with Reserved Font Name
"Bravura". Licensed under the SIL Open Font License, Version 1.1 — full text in
[`licences/BRAVURA-OFL.txt`](licences/BRAVURA-OFL.txt).

`src/render/glyphs.ts` contains outline data extracted from Bravura by
`tools/extract-glyphs.mjs`. It is a derivative of the font and is distributed
under the same licence.

No font file is shipped, and nothing here is distributed as a font named
"Bravura" — the OFL reserves that name for the original.

## FluidR3_GM — instrument samples

Copyright © Frank Wen. Licensed under
[Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/)
— full text in
[`licences/FLUIDR3-CC-BY-3.0.txt`](licences/FLUIDR3-CC-BY-3.0.txt).

`public/samples/` contains a subset of the soundfont — roughly sixty notes across
four voices — converted to MP3 and packaged by
[gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts).
`tools/fetch-samples.mjs` reproduces the extraction.

CC-BY permits commercial use and imposes no share-alike obligation, so these
samples may be distributed in a paid application provided the attribution above
travels with it.

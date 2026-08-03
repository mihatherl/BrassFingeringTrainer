# Brass Fingering Trainer

An installable web app for drilling brass valve fingerings. Notation scrolls past
a strike line at a set tempo; you hold the right combination of three on-screen
valve buttons as each note arrives. It runs on phone, tablet and desktop, works
offline, and covers the brass band instruments in both clefs.

## How it works

**One fingering engine for the whole band.** A valved brass instrument is a tube
with a harmonic series plus valves that lower the pitch by a fixed number of
semitones. To finger a note you take the nearest harmonic at or above it and
press the valves that close the gap. That is the entire algorithm
(`src/domain/fingering.ts`), and it derives correct fingerings for every
instrument from a single number — the sounding pitch of the open fundamental.

Two things are deliberately kept apart (`src/domain/instruments.ts`):

| | determines |
|---|---|
| `fundamentalMidi` | fingering |
| `transposition` | how written pitch maps to sounding pitch, per clef |

Separating them is what makes brass band treble clef work out. Its
transpositions are chosen so written C always lands on the 2nd partial, so a
cornet player and an Eb bass player use identical fingerings for identical
written notes — while the same written C sounds Bb3 on one and Eb2 on the other.
That behaviour is not special-cased anywhere; it falls out of the arithmetic, and
there is a test asserting it holds across the whole band. Bass clef is concert
pitch, which is exactly why its fingerings are instrument-specific, and it needs
no special-casing either.

Two details that are easy to get wrong, and are covered by tests:

- **The 7th partial is excluded.** It is roughly a third of a semitone flat and
  no player uses it. Allowing it silently corrupts the upper register — written
  high A comes out as valve 2 instead of 1-2.
- **The 4th valve is virtual.** Notes below the three-valve floor are worked out
  with a 4th valve and the 4th is then masked out of what you must hold, so
  written low F asks for valve 1. The fallback only applies where no three-valve
  fingering exists at all; otherwise a bare 4th-valve combination would mask down
  to "no buttons" and the app would accept open valves for a note fingered 1-3.

**Timing comes from the audio clock.** `AudioContext.currentTime` is the only
source of musical position (`src/engine/clock.ts`). Audio is scheduled ahead onto
the audio thread; the render loop merely reads the same clock each frame. Neither
drives the other, so a dropped frame costs smoothness and nothing else. Deriving
position from `requestAnimationFrame` deltas or `Date.now()` would let the
notation drift out of step with the sound, which is the one fault a rhythm
trainer cannot have.

**There are two reading modes** (`src/render/surface.ts`). *Scrolling* moves the
music past a fixed strike line, which says exactly when to play — good for
learning fingerings. *Paged* holds the music still and turns the page as the
player nears the end of it, with nothing but the metronome marking the beat, so
the counting is left to the player. They are the same drawing code with a
different origin, and judging is identical in both because it works from
scheduled beat times and never from anything on screen.

**Judging asks whether an accepted fingering was held at any point in a window
around the onset** (`src/engine/judge.ts`). So holding 1-2 across four notes that
all use 1-2 is correct — as it should be, since lifting would be wrong — and
legitimate alternate fingerings are accepted rather than marked down.

## Running it

Needs Node 20+. If you use nvm: `nvm install --lts`.

```bash
npm install
npm run dev            # http://localhost:5173
npm run dev -- --host  # also serve on the LAN, for testing on a phone
```

```bash
npm test               # 301 tests
npm run build          # typecheck, bundle, generate the service worker
npm run preview        # serve the production build
```

Deploy by copying `dist/` to any static host. The only runtime requests are for
the instrument samples, and those are precached along with everything else, so
the app is fully offline after the first load.

## Layout

```
src/
  domain/      pitch, keys, rhythm, instruments, the fingering engine
  exercise/    seeded RNG, difficulty presets, generators
  engine/      transport clock, valve input, judging, session orchestration
  audio/       sampled brass, fallback synth, backing pad, metronome, context
  render/      glyph outlines, stave geometry, note drawing, scrolling surface
  ui/          React screens — settings, play, results
  storage/     settings and per-note accuracy in localStorage
```

React owns the menus. The play surface is a plain-TypeScript renderer drawing to
a raw canvas that React only mounts — nothing in the animation or audio path goes
through React state.

## Generated assets

Two committed files come from authoring scripts. Neither runs during a build, and
neither adds a runtime dependency.

```bash
# Music glyph outlines -> src/render/glyphs.ts
npm i -D opentype.js
curl -fsSLO https://github.com/steinbergmedia/bravura/raw/master/redist/otf/Bravura.otf
node tools/extract-glyphs.mjs Bravura.otf
npm uninstall opentype.js

# PWA icons -> public/icons/
python3 tools/make-icons.py   # needs Pillow

# Brass samples -> public/samples/ and src/audio/sample-manifest.ts
node tools/fetch-samples.mjs
```

Notation is drawn from Bravura outlines baked into source as SVG paths, so the
app ships no font file and loads nothing over the network at runtime.

## Credits

- **Bravura** music font by Steinberg Media Technologies GmbH — SIL Open Font
  License 1.1. Glyph outlines are extracted into `src/render/glyphs.ts`.
- **FluidR3_GM** soundfont by Frank Wen, packaged by
  [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) —
  Creative Commons Attribution 3.0. A subset lives in `public/samples/`.

CC-BY requires attribution to travel with the app rather than only with the
source, so both notices also appear on the settings screen.

## Sound

Each instrument plays a recorded voice, chosen for bore and register rather than
name, since General MIDI has no cornet, tenor horn, baritone or euphonium:

| Instrument | Sampled as |
|---|---|
| Cornet, flugel | trumpet |
| Tenor horn | french horn |
| Baritone, euphonium | trombone |
| Eb and Bb bass | tuba |

Samples sit three semitones apart and are pitch-shifted to reach everything
between, so nothing is ever stretched by more than a tone. Roughly 1.4 MB in
total, precached so every instrument works offline. If loading fails the app
falls back to synthesis rather than refusing to run.

The pad that plays underneath in "play what I finger" mode stays synthesised on
purpose: these mp3 exports carry no sustain loops, so a sampled pad would decay
and die under a held note, which is exactly where a pad has to hold.

## Testing notes

The suite covers the fingering engine against published charts, exercise
generation, judging, stave geometry, the canvas draw path (against a mock
context) and the React screens (happy-dom). What it cannot cover without a real
browser is audio output and multi-touch, so those are worth checking by hand:

- **Multi-touch** — `npm run dev -- --host`, open on a phone, confirm three
  simultaneous presses register and that sliding a finger off a button releases
  it cleanly.
- **Audio** — confirm the count-in clicks, the synth sounds on pitch, and that
  the first tap unlocks audio on iOS.
- **Offline** — build, serve, load once, then kill the network and confirm a cold
  start still plays.

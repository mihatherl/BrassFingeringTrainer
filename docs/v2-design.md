# Version 2 — direction and the thinking behind it

Written after v1.0.0 was tagged and deployed. Everything here was decided in
discussion; none of it is derivable from the code, and several of the rulings
came from playing experience rather than from reasoning about the software. It
is written down so it does not have to be argued out again.

## Where v1 ended

An installable PWA that drills valve fingerings against notation, judged by
three on-screen buttons. Tagged `v1.0.0`, deployed to GitHub Pages, 333 tests.
Fully offline, no backend, no runtime network requests at all — that last part
is a property worth defending rather than an accident.

## The direction

In order. Each step is useful on its own, so this need not be delivered as one
release.

1. **Ties and tuplets**, wired into the generator so Hard and Expert gain
   triplets immediately.
2. **Key changes.**
3. **A tempo map** — step changes first.
4. **MusicXML import from a local file.**
5. **A server**, only if step 4 shows people want a library rather than their
   own files.

### Why local import before a server

A server buys a library, sharing and sync. It costs hosting, availability,
auth, the offline guarantee, and a copyright question — hosting other people's
band parts is a materially different act from someone opening their own file.

The parser and the data model are identical either way. Build the importer
against a file picker; if a library proves worth having, the server serves the
same format and nothing in the app changes.

**MusicXML rather than MIDI.** MIDI discards spelling and key, which are the
two things this app cares most about.

## What the model costs

Sized against the code as it stood at v1.

| | Cost | Where the work is |
|---|---|---|
| Ties | Small | A flag on the note, one judging rule, a bezier |
| Triplets | Moderate | Bracket, numeral, beaming |
| Fermata | Small to draw | But see below |
| Key changes | Moderate–high | ~97 references to `fifths` |
| Tempo changes | High risk, low volume | `timeForBeat` — three lines that hold everything up |

**Triplets are already half-built.** Timing works in beats as floating-point
numbers and `timeForBeat` is a single multiplication, so a triplet crotchet at
⅔ of a beat already schedules, judges and spaces correctly. What is missing is
purely notational.

**Key changes ripple.** Most of those references only pass `fifths` around, but
every `spellInKey` call becomes "which key is in force at this beat", and a
mid-system change needs cancelling naturals and a double bar.

**Tempo changes are the risk.** `timeForBeat` is the foundation of scheduling,
judging and the render loop, and a bug there desynchronises sound from notation
— the one fault a rhythm trainer cannot have. The volume of code is small; the
tests should be brutal.

## The tempo map

With tempo varying linearly across a span, both directions are closed form. No
numeric integration, no accumulated drift, and the inverse is a real inverse
rather than a search — which matters, because the render loop needs time → beat
sixty times a second while the scheduler needs beat → time.

Where `bpm(b) = m·b + c`:

```
t(b) = t₀ + (60/m)·ln((m·b + c) / (m·b₀ + c))
b(t) = ((m·b₀ + c)·e^(m(t−t₀)/60) − c) / m
```

`m = 0` degenerates to the constant-tempo case and needs guarding.

### What a tempo map changes elsewhere

- **Paged reading is unaffected.** Its spacing was deliberately decoupled from
  tempo in v1 — room follows the notes, not the clock.
- **Scrolling has to speed up and slow down.** Spacing stays fixed and the music
  physically moves faster, because it *is* going faster. Varying the spacing
  instead, to hold pixels-per-second constant, would make notes visibly bunch
  during a rit. and lie about the notation. So `scrollSpeed` becomes "pixels per
  second at the nominal tempo".
- `toleranceFor` needs the local tempo at the note being judged, not a global
  one.

## The on-screen conductor — spiked, and it works

`public/spike/conductor.html`. Tested on 2026-08-08 against an Eb bass: the beat
reads from a bare moving dot and can be played to "as I would a real
conductor", and **a rit. can be followed** by dragging the tempo. That second
one was the doubtful question and the reason for building the spike at all.

An animated stick above the music, where a conductor actually sits in a
player's vision.

**The reason it is worth building**: a click tells you where the beat *is*; a
conductor tells you where it is going to be. Players who only practise to a
click get led by the beat rather than anticipating it. And a metronome cannot
teach you to follow a rit. by definition, so a conductor with a tempo map is the
only way to practise the hardest ensemble skill there is.

**The thing that decides whether it works: the ictus is carried by
acceleration, not position.** A conductor's hand speeds up into the beat and
slows after it, and that change of speed is the whole information. Animated at
constant speed round the pattern, the beat is invisible and the feature is worse
than nothing.

**It needs no tempo logic of its own.** Hand position is a pure function of
beat, read from `visualBeat()`. When beats arrive slower the hand moves slower,
including the acceleration into each ictus.

**Where it cannot go**: landscape on a phone. The stave there is sized by the
height and a conductor above the music comes straight out of the notation.
Portrait and tablets have the room.

**Keep the metronome.** Not either/or — watch the stick while hearing the click,
then turn the click off. That is how you would teach it to a person.

**What the spike measured.** The brief was "the ictus is carried by
acceleration", so the first thing built was a check on whether it actually was.
It was not: easing the sideways travel — the obvious thing to do, so that the
hand pauses at each ictus — makes horizontal speed peak *between* beats and
cancels most of the vertical whip, giving only 1.9x the speed at the beat.
Sideways travel must be linear, which takes it to 3.2x. Peaking the arc early so
the hand "falls into" the next beat sounds right and measures worse, because a
longer descent from a fixed height is a slower one. The symmetric parabola wins.

The spike shows that ratio on screen beside a slider for the rebound depth, so
the figure can be tuned by eye and reported rather than guessed at.

**The rebound depth is the legato-to-marcato axis, and it should stay
configurable.** A conductor beating a lyrical phrase uses a smooth continuous
gesture with little rebound; one driving a march gives a sharp ictus and lets
the hand stop between beats. Both are correct conducting, and the user described
the default as "a lively conductor" — so the setting is named in those terms
rather than in numbers.

It is also a **difficulty axis**, which is the part worth building on: a smooth
conductor is genuinely harder to follow, and learning to find the beat in a
vague gesture is a real skill that no metronome can teach. And it could vary
through a piece, since a real conductor changes style with the music — an
obvious thing for imported music to carry, alongside the tempo marks.

One caution: there is a floor below which the gesture stops being vague and
starts carrying no information at all. The measured ratio is the guide, and the
app should not let the slider go below whatever proves unreadable.

**What this does to the order.** The tempo map now has two customers rather than
one — the conductor needs it as much as imported music does, and it is what
makes a fermata practisable. There is a case for moving it ahead of key
changes.

## Fermata

Draw it whenever, but it has no honest meaning against a metronome. A fermata
means "hold until released" and there is no conductor to release you. It becomes
practisable exactly when there is something that can release you — the on-screen
conductor, or the microphone hearing you stop.

## The microphone, parked

Proven and then deliberately set aside in favour of the notation work above.
Nothing here is speculative; it was measured.

- **It works.** Tested on an Eb bass and a Bb cornet. Two recorded takes
  analysed offline: a G major scale (14 notes) and a chromatic octave and a half
  (18 notes), both with **zero** wrong notes and zero frame-level octave leaps.
  The recordings are in `spikefiles/` and the harness is
  `tools/analyse-recording.mjs`.
- **Notes settle after roughly 0.2s.** Part window-filling, part the lips
  genuinely not having found the pitch yet.
- **Therefore timing and correctness are two different measurements.** Onset
  from the amplitude envelope, which is reliable at the attack; pitch from the
  settled portion. Judging pitch at the onset would be judging exactly the
  200ms shown to be unreliable.
- **The instant green confirmation from v1 cannot survive.** The earliest honest
  confirmation is about 200ms after the attack.
- **The anti-aliasing filter is load-bearing for correctness**, not merely for
  cheapness. See the comment in `public/spike/spike.js` and `check.mjs`.
- **What it would buy beyond convenience**: the app would know what *came out*
  rather than what was pressed, so it could tell a cracked partial (a lip
  problem) from a wrong fingering (a knowledge problem). Those need entirely
  different practice.
- **Keep the buttons.** Practising fingerings without the instrument is half of
  what a fingering trainer is for, and the buttons are the fallback when the
  microphone is declined or the room is too loud. The microphone half must be
  additive: declining the prompt should leave exactly the app that exists today.

### Two rulings from playing experience

**Accept any octave.** If an E was called for and any E was played, treat it as
correct. Measured: **19 of 19** octave pairs within the playable range share a
fingering, on both Eb bass and cornet, with no exceptions — a note an octave up
sits on partial 2n with the same valve offset. So the rule costs nothing. It
gives up detecting an octave *pop*, but cracking to an adjacent partial gives a
3rd, 4th or 5th, and those are all still caught.

**The 4th valve stays invisible, everywhere.** It was made virtual in v1 and
must not reappear, including in any tuning feature — amateur players rarely
adjust it and cornets have not got one. This is a correctness requirement as
well as a simplification: five notes on an Eb bass are 4th-valve notes wearing
three-valve clothes, and measuring the first slide on one of them would blame it
for the fourth's fault.

| Shows as | Really |
|---|---|
| F3 = 1 | 1-4 |
| E3 = 1-2 | 1-2-4 |
| E♭3 = 2-3 | 2-3-4 |
| D3 = 1-3 | 1-3-4 |
| D♭3 = 1-2-3 | 1-2-3-4 |

Any feature reasoning about physical slides must exclude notes where
`Fingering.usesFourth` is true. On a cornet, none are affected.

## The tuning function

Designed, not built. Parked with the microphone, since it needs one.

A chromatic tuner has no idea which valves were held, so it can tell you a note
is 20 cents sharp but not what to pull. This app knows the fingering *and* the
partial, so it can attribute the error:

```
measured = main slide + valve slides + partial physics + your lips
```

Three of those four are knowable; fit them by least squares over enough notes
and they separate. The partial offsets are known physics — the 5th partial is
about 14 cents flat by nature, and blaming a slide for that would send someone
chasing a fault that is not there.

The exercise generates itself from the fingering engine. For an Eb bass in
treble clef, excluding the 4th-valve notes above:

| Slide | Notes |
|---|---|
| open | C4 G4 C5 E5 G5 |
| 1 | B♭3 F4 B♭4 D5 F5 |
| 2 | B3 G♭4 B4 E♭5 G♭5 |
| 1-2 | A3 E4 A4 D♭5 |
| 2-3 | A♭3 E♭4 A♭4 |
| 1-3 | G3 D4 |
| 1-2-3 | G♭3 D♭4 |

1-3 and 1-2-3 have only two usable notes each, and those are the combinations
most likely to be sharp, so they want measuring twice rather than pronouncing on
one reading.

Advice can be in millimetres. An Eb bass fundamental of 38.9 Hz is about 4.41 m
of tubing, so **1 cent ≈ 2.5 mm of tubing ≈ 1.3 mm of slide pull**. Approximate,
because a real instrument is not an ideal pipe — so measure, adjust, measure
again rather than pronouncing once.

**Three limits worth stating in the UI.** Your lips will hide the fault, because
correcting sharp notes is what playing is; trust the *pattern* across
combinations more than any absolute number. A cold instrument is a flat one, so
it has to insist on warming up. And valve combinations are systematically sharp
by construction — finding exactly that pattern is a sign the measurement is
real rather than noise.

## The spike itself

`public/spike/` is a deliberately plain page with no build step, excluded from
the service worker so it can neither be precached nor swallowed by the
navigation fallback. It has live pitch detection, note segmentation, offline
analysis of any audio file the browser can decode, and a flight recorder that
keeps the last 15 seconds so an intermittent fault can be caught *after* it
happens.

`node public/spike/check.mjs` runs the detector against synthetic tones across
the band, and `node tools/analyse-recording.mjs <file.wav>` runs it over a
recording and prints the notes it heard.

It is throwaway. If the microphone work resumes, the detector gets rewritten in
TypeScript with the recordings as fixtures; if it does not, the directory gets
deleted.

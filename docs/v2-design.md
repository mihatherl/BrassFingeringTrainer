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
   triplets immediately. *Ties are built; tuplets are not.*
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

### Ties, as built

The estimate held: a flag on the note, one judging rule, a bezier. What was
decided while building it:

**Ties come from crossing the bar line, and nothing else.** A note that fits
inside its bar can be written as one note and should be. The rhythm generator
therefore runs across the whole exercise rather than a bar at a time, and its
one liberty is letting a note overrun, with the remainder written again on the
downbeat. Both halves have to be real note values, so a tie is never a way of
writing an arbitrary length.

**They arrive at Medium**, alongside dotted rhythms, and never in a scale or
arpeggio — that drill is the shape and the fingering, and a tie there is a
reading problem laid on top of a different exercise. `tieChance` is conditional:
how often a bar end that *could* be tied over is, rather than a rate diluted by
every position that could never have produced one. Measured at roughly one tie
every three bars.

**The far end of a tie is not judged, and that is the whole rule.** It is not
sounded either — the synth plays the chain's full length as one note — and it
takes no accidental, no hint and no place in the totals. Judging it would mark
the player correct for holding a fingering they were already holding, which
would inflate both the score and the per-note accuracy that weak-note drilling
and hints read from. It does take its head's *colour*, since one sound should
not be half green.

**A tie broken across a system is the ordinary case, not an edge case** — the
thing exists to cross a bar line, and a system break is a bar line. Each end is
placed independently, against its notehead or against the margin.

`tools/stave-to-svg.mts` renders an exercise to SVG so engraving can be looked
at without a browser. It found the one thing the tests could not: the first
ties drawn were specks, because clearing half a notehead at each end ate most of
a crotchet's column. A tie's tip sits a stave space off the head's centre, where
the ellipse has already narrowed, so it need not clear the full width.

### Groundwork, laid before the dynamic work

Two refactors done together after ties. Both are behaviour-preserving — the 354
tests were green either side — and both were worth doing on their own merits.
They change the costings above.

**Everything asks the clock for seconds now, not for a tempo.** Every use of
`secondsPerBeat` outside the clock turned out to be the same question in
disguise: *how many seconds between these two beats*. A note's own length, the
gap before the next note, the slack a note gets — all of it. So `Transport`
grew `secondsBetween(fromBeat, toBeat)` and the field became
`nominalSecondsPerBeat`, which is now used by exactly one thing.

`toleranceFor` is the clearest case. Its old body was
`0.3 × secondsPerBeat × durationInBeats`, which is `0.3 ×` the note's length in
seconds and never anything else; it now takes that directly. The note in this
document that it "needs the local tempo at the note being judged" was wrong —
it needs no tempo at all, and neither does anything else.

So a tempo map changes the body of `timeForBeat`, `beatForTime` and
`secondsBetween` and nothing else. **The one exception is deliberate**: the
scrolling display multiplies `scrollSpeed` by the *nominal* rate, because how
far a beat travels is a property of the page. Spacing that tracked a varying
tempo would bunch the notes during a rit. and lie about the notation.

**Notes carry their own spelling.** `SpelledPitch` moved onto `NoteEvent`,
settled at generation time for the same reason the fingerings and the
accidental already were: it depends on the key, and the key is something the
generator knows and the renderers should not have to. F sharp and G flat are
the same sound and a different thing to read.

That removes `fifths` from the renderers entirely bar the key signature glyphs
themselves, which is most of what made key changes look expensive. It also
stopped `drawSystem` re-spelling every visible note on every frame.

### The order agreed

Revised from the list at the top of this document once the conductor gave the
tempo map a second customer, and agreed rather than assumed.

1. ~~`secondsBetween`~~ — done
2. **The conductor** — no prerequisites at all; it needs `visualBeat()` and a
   height budget, and it is what makes a fermata mean anything
3. ~~Spelling onto `NoteEvent`~~ — done
4. The tempo map, behind the three clock functions
5. Fermata — needs the conductor and the tempo map, *and* a change to the
   transport's contract; see below
6. Key changes

**Fermata is not a tempo problem, and grouping the two will mislead.** A tempo
map is known in advance: closed form, schedulable, testable. A fermata's
release is not — it comes when the conductor releases or the microphone hears
you stop. But `Transport.tick` marches `scheduledUntilBeat` forward over a
150ms horizon and the session pushes notes onto the audio thread before they
sound, so **nothing can be scheduled past a hold of unknown length**. The
transport has to stop advancing its horizon at the fermata and resume on
release. That is a change to its contract, not to its arithmetic, and it is the
one item here that touches the invariant this document calls the fault a rhythm
trainer cannot have.

**Key changes ripple.** Most of those references only pass `fifths` around, but
every `spellInKey` call becomes "which key is in force at this beat", and a
mid-system change needs cancelling naturals and a double bar.

**Tempo changes are the risk.** `timeForBeat` is the foundation of scheduling,
judging and the render loop, and a bug there desynchronises sound from notation
— the one fault a rhythm trainer cannot have. The volume of code is small; the
tests should be brutal. Since the groundwork below, the whole of that risk sits
in three functions and nothing outside the clock has to change.

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

**What the spike measured, and then had to unlearn.** The first model drew
straight lines between the beat points and subtracted a parabola, and the
measurement was the ratio of speed at the ictus to speed between beats — 3.2x
with linear sideways travel, 1.9x if the sideways travel was eased. Both the
model and the measurement were later replaced; see *How the patterns are built*
below. Two things from that round survived and are worth keeping:

- Easing the sideways travel makes horizontal speed peak *between* beats and
  cancels the vertical whip. Whatever the model, the sideways motion must not be
  eased independently of the vertical.
- A figure reported on screen beats an impression. Every change since has been
  argued with a number beside it.

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

## How the patterns are built

Arrived at over several rounds of comparing the drawn shape against conducting
diagrams and against Lesley Mann's *Music in Motion* (Belmont University,
CC-BY), a copy of which is in `input/conducting`. Written down because almost
every step of it was got wrong first, and the wrong versions all looked
plausible.

### Reading a diagram into a pattern

**Mirror it.** Every conducting diagram ever published is drawn from the
conductor's own point of view — four beats are down, to *their* left, to *their*
right, up. The player stands in front of them, so all of it arrives reversed.
Getting this backwards is invisible while you are only checking whether the beat
can be found, and wrong every time afterwards. It was wrong in the three pattern
for several rounds without anyone noticing.

**Key the pattern by pulses, never by the numerator.** 6/8 is beaten in two,
9/8 in three, 12/8 in four, and Mann's own sheet says so outright: 6/8 is "the
same pattern as 2/4 but with a triplet feel". `metre.ts` already computes
`pulsesPerBar`, and that is the index. This is also why compound time needs no
new patterns at all.

**Structural roles come first.** Mann: the cycle "begins with a characteristic
downward movement of the arm, the downbeat, and ends with an upward movement, or
the upbeat. If there are more than two beats in the meter, then additional
horizontal movements are added." So a two pattern is down and up with no
horizontal beat at all; a three adds one sideways; a four adds two. Place the
beats to that rule before fiddling with any curve.

**The floor is not universal.** The four pattern really does put all four
ictuses on one level. The two and the three lift their final beat above it — the
upbeat sits higher. Generalising the four's flat floor to the others flattened
the two into a plain dome and had to be undone.

**The last apex sits above the downbeat, not between the beats.** Mann's "the
final rebound must return to the starting point of the downbeat" is geometry,
not size: the starting point of a downbeat is the top of its own descent, which
is directly above where it lands. The hand sweeps up and across from the last
beat and then drops *straight*. Placing that apex at the midpoint made the
descent a diagonal and cost every pattern its most recognisable stroke.

**Some strokes need explicit via points.** The default — one apex per stroke —
cannot draw the two pattern, whose hand sweeps *past* beat two, reverses, and
comes back so the second hook curls the opposite way. One turning point out
beyond beat two drags beat one's tangent diagonal and destroys its hook instead.
So a stroke may carry its own list of points, threaded onto the same curve.

### The three parts of a beat

Mann again, and all three are worth naming separately because they are
separately adjustable:

- **The ictus** is "the change in direction that is interpreted by an ensemble
  as the actual beat", seen at the tip of the baton. Not a speed maximum, not a
  position. Scoring patterns by speed instead quietly rewarded long lazy loops
  and steered the design wrong for several rounds.
- **The rebound** is the movement immediately after, "typically one-third to
  one-half the size of the ictus" — except the final beat of the bar, which is
  large because it has to get back up to the downbeat's starting point.
- **The prep** is "essentially the rebound of the prior beat". One movement
  named twice, so it is stored once: each beat carries a single `rebound` and
  the arrival is the tail of the previous beat's.

That last point is what makes the final-beat rule automatic rather than
hand-maintained, and the two had drifted 12–22% apart while both were tuned by
eye.

The one-third-to-one-half ratio is checked by an audit script rather than
trusted. Two beats currently sit outside it — the beat before the long
horizontal stroke, in both the three and the four — and that is a deliberate
disagreement with the text on the strength of the diagrams and of playing to it.

### Shape and timing are separate mechanisms

The whole bar is **one closed spline** through the beats and the apexes between
them, and the ictus is a point *on* that curve. Building each stroke as its own
curve, starting and ending at a beat, makes every ictus a seam where two
tangents disagree — so the tip turns a hard corner, which a hand with mass
cannot do. Measured, that was a 180° tangent flip; on one curve it is 0.4°.

Timing is then a separate phase warp: hurry through the beat, linger at the
apex, like a thrown ball. Keeping them apart is what lets the path stay smooth
while the motion stays sharp. In the old model they were the same mechanism,
which is exactly why every attempt to make a beat readable cost the shape and
vice versa. The legato-to-marcato setting drives the warp, not the geometry.

### The two figures worth reporting

- **Flick** — the vertical reversal, sampled a short way either side of the beat
  rather than at it, since on a smooth curve the vertical velocity is exactly
  zero at the ictus however sharp the turn. This is the ictus as Mann defines it.
- **Speed contrast** — how much faster the tip moves at the beat than between
  beats. Useful, but secondary; it is not what a beat *is*.

The page also prints a fingerprint of the drawn geometry, sampled off the curve
rather than hashed from the numbers behind it — the shape changed twice without
a single coordinate moving, and a fingerprint of the inputs would have said "no
change" both times.

### Metres we have no pattern for

There will always be some, and imported music guarantees it. **The conductor
switches off and the metronome carries on**, rather than guessing. A conducting
pattern is a specific taught shape, not something to interpolate: a five is not
a four with a beat wedged in, and an invented one would teach a player to follow
a gesture no conductor will ever make. Silence from the conductor is honest; a
plausible-looking wrong pattern is not.

Patterns exist for two, three and four pulses, which covers every simple metre
the app offers today and 6/8, 9/8 and 12/8 when compound time arrives. Five and
seven are drawn on the reference sheet in `input/conducting` and can be added
from it when wanted.

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

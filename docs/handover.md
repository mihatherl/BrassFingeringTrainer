# Handover — 2026-08-18, written for the two-workspace session

You are picking up **one half** of a two-app product, most likely from a parent
folder holding both this repository and its sister. This half is *Brass
Master*: the practice app, web and — from version 3 — the App Store. The other
half manages MusicXML files from a desktop. They meet at one seam, and holding
both in one head is the whole reason that session exists.

**Read this file, then one plan document for the task in front of you. Nothing
else, until you need it.** The last session's problem was a flooded context,
and this file is written to prevent yours.

## What to read, and what to leave alone

| | Lines | When |
|---|---|---|
| `handover.md` — this file | ~280 | Now, all of it |
| `app-store-plan.md` | 241 | **Before any version 3 work.** What is free, what is paid, what the split costs |
| `v2-design.md` | 2,943 | **Never end to end.** The durable rulings; grep it for the noun you are touching |
| `musicxml-import-plan.md` | 477 | Only when touching `import/` |
| `tempo-map-plan.md` | 607 | Only when touching the clock or the conductor |
| `endless-play-plan.md` | 161 | Only when touching the offer or scoring |
| `tunes-plan.md` | 102 | Only when touching the theme composer |

The code is 22,000 lines of production TypeScript and 17,000 of tests. Do not
survey it. **Every "why is it like this?" has an answer in `v2-design.md`, and
the way to find it is to grep for the noun** — `grep -n "fourth valve"`, `grep
-n "open note"` — not to read the file. Its section headings are a map:
`grep -n "^## " docs/v2-design.md`.

## Where this side stands

**v2.23.4, deployed and green.** 1,097 tests across 52 files. The gate before
any push is `npm test && npm run build && npm run lint`, all three, every time.

A brass-fingering trainer: it generates or imports notation, scrolls it past a
strike line, and judges whether the player had the right valve combination down
as each note arrived. Buttons on screen or keys 1/2/3. It has a metronome, an
animated conductor, a tempo dial, a key dial that re-keys mid-run, a reference
tone that follows the fingers, weak-note drilling, and My Music — parts
imported from MusicXML files. No backend, no network at runtime, no accounts.
It is a PWA on GitHub Pages, and the intention is a paid iPhone app in version
3.

## What today did — three commits

**`6b30cc6` Cut the seam the microphone will arrive through.** `PlayerInput`
(`engine/player-input.ts`) is now what the session and judge ask questions of:
`subscribe`, `stateAt`, `statesDuring`, `answers`, `clearHistory`, `release`,
with a state of `{ from, to, mask, playing }`. `Session` takes one rather than
making one, and keeps it private; `PlayScreen` makes the `ValveInput`, since it
drew the buttons. The buttons' own rules moved behind the seam — including the
open-note engagement rule, which is a rule about *buttons* and must not be
inherited by a microphone that can hear the difference. `player-input.test.ts`
drives whole sessions off a second implementation to prove it.

**`d3cd2f8` Never let the app play a run that cannot be heard (v2.23.4).**
Three corrections to the audio-context work: the stall check watched whatever
`getAudioContext()` handed back rather than the run's own context; `markStuck`
could condemn a context that had already replaced the dead one; and the gate
started runs whose final `ensureRunning()` had failed. `audio-gate.test.tsx` is
new and is the only test in the suite that goes past "Tap to start" — it can,
because the failing path never mounts the canvas.

**`0088141` Settle what is free, what is paid, and what the split costs.**
`app-store-plan.md`. Read it before version 3.

## The fault that was not a fault, and the lesson in it

The player reported no audio at all — metronome and instrument — on the
deployed app on an iPhone. **The cause was the phone's silent switch.** iOS
applies it to Web Audio, which is all this app uses, and not to media elements,
which is what the YouTube video they tested the speaker with was. So the
speaker test passed while the app was muted.

Worth knowing structurally: **nothing in this app can silence both.** The
metronome, the pad and the sampler each build their own gain and connect
straight to `context.destination`, and there is no `setSinkId` anywhere — the
calibrated "output" is a *lead*, not a route. Metronome and instrument going
quiet together is the context or the device. One voice quiet while the beat
carries on is the app's, and means a voice built on a context that has since
been replaced. This is written up as *When the app has no sound* in
`v2-design.md`.

## The other side, which I have never seen

Everything below is what the player told me, not what I have read. **Fill this
section in within the first ten minutes of the combined session, before writing
any code that assumes an answer.**

- A sister app, in development in a separate session, **serves a URL to a
  laptop the way VLC does**, so MusicXML files can be managed from a desktop
  computer rather than through a phone's file picker.
- It is the reason My Music becomes paid-only: the feature is being rebuilt
  around it, not withheld.

Questions whose answers change work on *this* side:

1. **Which end runs the server?** VLC's model is that the phone hosts and the
   laptop browses to it. Confirm, because it decides whether this repository
   ever needs native code and a local-network permission, or whether it is
   merely a client.
2. **What is the sister app — desktop application, or the phone's server
   component, or both?** Its stack, its repository path, how to run it, and its
   own gate.
3. **What crosses the wire** — whole MusicXML files, or something already
   parsed? Strong recommendation: **files, unparsed.** The parser on this side
   is 2,900 tested lines and must stay the single place that reads MusicXML.
4. **Who owns the library** — the phone, with the desktop as a remote control,
   or a synchronised pair? Recommend the first; a synchronising pair is a
   different and much larger project.
5. **What the desktop may ask for**: list, add, rename, delete, reorder? That
   list *is* the contract.

## The boundary, which is why one session holds both

`storage/library.ts` (239 lines) and `storage/pieces.ts` (139) are the line on
this side — the pieces the player has opened, kept between sessions. That is
what a desktop would drive.

`import/musicxml.ts`, `part.ts` and `unfold.ts` are indifferent to where a file
came from and **must stay that way**. If the parser learns about the network,
the boundary has been lost.

Nothing about the sister app should reach into `exercise/` or `engine/`. A
piece becomes an `Exercise` and from there the app cannot tell it from
generated music — that is a ruling already made (*The seam already exists, and
it is `Exercise`* in `v2-design.md`) and it is the reason import cost so little.

**Define the contract before either side builds to it**, and write it down in
one file that both workspaces can see. That is the single highest-value thing
the combined session can do first.

## Rulings a newcomer breaks

- **The fourth valve stays invisible, everywhere.** Five notes on an E flat
  bass are fourth-valve notes wearing three-valve clothes. `Fingering.usesFourth`
  exists for this, and **the intelligent tuner is the first feature that has to
  read it** — a tuner that blames the first slide after hearing an F3 is telling
  the player to bend a slide that was never in the sound.
- **The clef shows once, on the first line only** — not on the topmost visible
  line. Got wrong in 1.2.1, fixed urgently in 1.2.2.
- **Import unfolds, it does not navigate.** Repeats are expanded into a
  straight read; scanning is explicitly not this app's problem.
- **An open note asks for evidence** — and that rule belongs to the buttons,
  inside `ValveInput.answers`, not to the judge.
- **The clock is the truth and the sound moves.** Every sound is handed over
  early by the output's lead; notation and judging read the clock unchanged.
- **Nothing is inferred from silence.** Carrying on past the end is something a
  player *asks* for, by pressing or by playing on.
- **No double accidentals**, anywhere in spelling.
- **No network requests at runtime.** It is what makes the app offline,
  private, and cheap to sell once. Protect it deliberately.

## What is left, carried forward

**Version 2, none of it blocking version 3:** the theme composer's stages 2 and
3 (wants the player's ear on the shape first); the settings screen overflowing
by 70 points on a 360×740 phone; the key-change collision on the scrolling line;
leaps per instrument rather than per difficulty; the conductor's compound-time
verdict and its two guessed thresholds; the importer's four gaps (tempo marks,
`<transpose>`, a real multi-part score, the long-rest skip); and the v2.16.1
sample-early fix, withdrawn and not asked for back.

**Refactorings worth doing before building on top:** the *Monitor* — pulling
`followFingers` and `applyVolume` out of `Session` — which is now tidying
rather than untangling, since they read the input through the seam like
everything else; `SettingsScreen.tsx` at over a thousand lines; `generate.ts`
at over sixteen hundred, most of it the walk, with the drills waiting to be cut
out as `compose.ts` already was.

**Version 3, in the order `app-store-plan.md` argues for:** the name and domain
checks; the build target (`VITE_TARGET=web|app`); the player's decision on the
runtime entitlement tier; **the container spike — microphone inside the real
wrapper, playing the reference tone while listening** — before the detector,
because it can change the detector's design; the cents measurement; the
detector in TypeScript against `spikefiles/`; the tuner; the library boundary.

## How to work here

**The gate is three commands and all of them count**: `npm test`, `npm run
build`, `npm run lint`. Check the build's own exit status, not a grep of its
output.

**Push without asking** once the gate is green — standing permission since
2026-08-10 — then confirm the deploy rather than assuming it. Tag every version
on its last commit at that version, and push with `--follow-tags`. Patch for
pure corrections, minor for features, major only for a change of category. A
refactor with no player-visible change gets no version bump.

**Write the ruling into `v2-design.md` in the same release as the code.** Plans
live in `docs/*-plan.md`. This file is replaced each session; the durable
things must be moved out of it before that happens.

**Mutation-test every new rule.** Change the rule, watch the test fail, put it
back. Every one that has been through this earned its keep, and one showed a
test asserting a seed coincidence rather than the invariant.

**Measure before deciding, and put the number in the docs.** The theme gap, the
tuba bloom, the headset lead, the response time, the pitch settle — all were
numbers before they were fixes.

**Look at the picture.** `npm run svg` renders an exercise to SVG, `npm run
shots` drives the real app at five viewports and photographs it, `npm run
tunes` engraves composed music by the dozen. Notation faults are positional and
no assertion sees them.

**Ship trials behind the URL** — `?tier=free`, `?voice=plain` — so a phone can
try something without a second deployment.

## Where I went wrong today

**I used `git checkout` to undo a mutation on unstaged files, and destroyed an
hour of uncommitted work.** Mutation testing means editing source, running,
and putting it back; `git checkout <path>` puts back *the committed version*,
which for uncommitted work is oblivion. I re-applied everything and re-verified
from a clean gate, but the rule to carry: **back up with `cp` before mutating,
never with git.**

**I instrumented the deployed app across six settings combinations before
asking the one question that resolved it in a sentence.** The probing was not
wasted — it proved the app schedules audio correctly, which is what let me say
with confidence that the fault was not in the code — but "what does the screen
do when it is silent, and which device?" should have come first. With a player
at the other end of the line, ask before you instrument.

## Drop this at the parent folder as `CLAUDE.md`

So a session opening the parent folder is oriented before it reads anything:

```markdown
# Brass Master — two workspaces

- `brass-master-app/` — the practice app (this handover: `docs/handover.md`).
  React + TypeScript + Vite, deployed to GitHub Pages. Gate: `npm test &&
  npm run build && npm run lint`, all three, from that directory.
- `<sister-app>/` — the desktop-side MusicXML manager. See its own README.

**Read `brass-master-app/docs/handover.md` first.** It says what to read next
and, more importantly, what not to.

The two meet at one seam only: the piece library
(`brass-master-app/src/storage/library.ts`). The MusicXML parser must never
learn about the network; the sister app must never reach into `exercise/` or
`engine/`. The contract between them lives in `CONTRACT.md` at this level —
write it before building either side of it.

Work one side at a time on a named task. The failure mode of a two-repository
session is reading both test suites into context and then having no room to
think.
```

Adjust the folder names to whatever you actually call them; the two rules under
them are the part that matters.

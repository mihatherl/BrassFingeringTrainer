# Two products, one codebase — the plan for Brass Master

Decided by the player on 2026-08-18, in answer to *what can we do now so that
shipping an app later is smooth*. This is the plan; the durable rulings it
settles will move into `v2-design.md` as they are built, and *Selling it, one
day* there is **superseded in part** — see *What this changes about the
licensing work*.

## The split, as decided

| | The free web app | The paid app |
|---|---|---|
| Where | A domain of its own, still GitHub Pages behind it | The App Store, iPhone first |
| Name | Brass Master | Brass Master |
| Price | Free, ungated | Paid |
| Has | **Everything built to date** — every key, every material, every difficulty, endless play, paged reading, weak-note drilling, the conductor, the tempo dial, the key dial | All of that, plus the three below |
| Does not have | My Music | — |
| Only here | **The microphone** — pitch in, fingering out, replacing the on-screen keys **in every mode**; **the tuner**, which hears a note and says which slide to move; **My Music**, and the desktop companion that manages the files |

**Why this is the right line.** The free app has to be worth using on its own
or nobody finds out the app is good — and everything up to v2.23.4 is a
complete practice tool. What is worth paying for is the three things that need
the phone's own hardware and a second device: hearing the player, correcting
the player's tuning, and getting their own parts onto the instrument. None of
those is a limit imposed on the free app; each is something the free app
genuinely cannot do.

**Why My Music moves.** Not because it is worth withholding, but because it is
about to be rebuilt: a sister app in development serves a URL from the phone to
a laptop, the way VLC does, so MusicXML files can be managed from a desktop.
That reworks the library end of My Music substantially, and it only makes sense
on a device that can run a local server. Building it twice — once for a web app
that cannot host it — is work nobody wants.

## Do not take My Music out of the web app yet

**The decision is the product's; the timing is not the same question.** My
Music works today, is deployed, and has nothing to replace it until the paid
app exists. Removing it now would take a working feature away from every
current user — the player included — months before there is anything to buy,
and the rework means the version that comes back will not be this one anyway.

**So: the code lands now, the switch flips at release.** Concretely, the door
in `SettingsScreen.tsx` is behind a build target from the start, and the web
build keeps including it until the App Store build is on sale. One line, one
day, one deploy.

## What this changes about the licensing work

This is the part worth reading before anything is written.

`entitlements.ts` and `licence.ts` were built for a different split: *one app,
fewer options*, where a free copy gets C major and Easy and a paid copy gets
the rest, decided at runtime by a flag that a purchase would eventually set.
The split decided today is not that. It is **two products from one codebase**,
each with a whole feature the other does not have, delivered through different
channels.

That changes the mechanism, not just the values:

- **A runtime entitlement is the wrong tool for a paid *feature*.** `isUnlocked`
  reads `localStorage['brass-trainer:unlocked']`, which anyone can set. That
  was harmless when the flag only chose between C major and all keys; it is not
  harmless if flipping it hands out the microphone mode. And shipping the
  microphone and the whole of `import/` in the free bundle to withhold them at
  runtime means shipping some 2,500 lines nobody in that build can reach.
- **A build target is the right tool.** `VITE_TARGET=web|app`, guarding the
  paid features at their entry points with dynamic imports so Rollup drops them
  from the build that does not want them. The free bundle then does not
  *contain* the paid features, which is both honest and smaller, and there is
  nothing to forge.
- **`FREE_TIER` as it stands is now wrong.** It withholds keys, difficulties,
  endless play, paged reading and weak-note drilling — all of which are free
  from today. Either it is redefined to withhold nothing, or the whole runtime
  tier goes and the paid line is drawn entirely at build time. **The second is
  simpler and I recommend it**, but it retires real work: the gated settings
  screen, `constrainToEntitlements`, the locked-control styling and their
  tests. Worth an explicit decision rather than an accident, which is why it is
  written here rather than done.
- **What survives either way**: `VITE_GATED` proved that a second build path
  must be built by CI or it rots, and that lesson applies unchanged to
  `VITE_TARGET`. Whatever replaces it, CI must build both targets.

**Open question for the player:** retire the runtime tier entirely, or keep it
for something? It is the one decision here I would not make alone.

> **Answered 2026-08-18, later the same day: retire it.** The split is drawn
> entirely at build time. See `v3-library-plan.md`, which records this and the
> library ruling together.

## The tuner, and the trap already written down

The tuner is the feature most likely to go wrong quietly, and this repo already
knows why. From *Two rulings from playing experience* in `v2-design.md`:

> **The 4th valve stays invisible, everywhere.** … This is a correctness
> requirement as well as a simplification: five notes on an Eb bass are
> 4th-valve notes wearing three-valve clothes, and measuring the first slide on
> one of them would blame it for the fourth's fault.

| Shows as | Really |
|---|---|
| F3 = 1 | 1-4 |
| E3 = 1-2 | 1-2-4 |
| E♭3 = 2-3 | 2-3-4 |
| D3 = 1-3 | 1-3-4 |
| D♭3 = 1-2-3 | 1-2-3-4 |

**So the tuner must refuse to draw a conclusion from any note where
`Fingering.usesFourth` is true.** A tuner that says "your first slide is sharp"
after hearing an F3 on an E flat bass is telling the player to bend a slide
that was never in the sound. The flag exists (`domain/fingering.ts:89`); the
tuner is the first feature that has to read it.

Two more things the tuner needs that the microphone spike did not measure:

- **Cents, not note identity.** The spike proved the detector names the right
  note (19 of 19, zero wrong across two takes). Naming a note and measuring how
  many cents sharp it is are different measurements with different stability
  requirements, and a brass player's pitch drifts with embouchure and breath
  within a single note. **Measure this before promising it**: how stable is the
  cents reading on a held note, on the player's own instrument, and how long a
  window does a trustworthy figure need?
- **Which slides the instrument actually has.** "Which slide to move" is
  instrument knowledge the app does not yet hold: an E flat bass has a main
  tuning slide and slides on 1 and 3 (and a fourth valve it must not talk
  about); a cornet has triggers on 1 and 3 and no fourth. That is a small
  addition to `domain/instruments.ts` and it should be data, not prose.

**And the octave ruling cuts the other way here.** For judging, any octave of
the right note counts — measured, and it costs nothing because octave pairs
share a fingering. A tuner cannot take that shortcut: it needs the pitch that
was actually sounded, since the slide correction depends on the partial. Same
detector, different question asked of it.

## The microphone replacing the keys, in every mode

This is the one thing on the list that is already prepared. The input seam cut
on 2026-08-18 (`engine/player-input.ts`) means a microphone is a new
`PlayerInput` and nothing else: the session, the judge, the tone that follows
the fingers, the hints and the results all ask the same questions of it. The
buttons' own rule about open notes lives inside `ValveInput` and is not
inherited. `player-input.test.ts` already drives whole sessions off a second
implementation, so the shape is proven before the detector exists.

What remains genuinely open, from *The microphone, parked*: onset from the
envelope and pitch from the settled portion are two measurements where the
buttons give one, and the instant green confirmation cannot survive in
microphone mode — about 200ms is the earliest honest one. Both are recorded
there; neither is affected by anything decided today.

## The sister app, and what it does to My Music

> **Settled 2026-08-18, later the same day:** the phone owns the library and
> serves it; the desktop side is a stateless converter only. The full ruling,
> including what it deprecates on the generator side, is `v3-library-plan.md`.
> The three consequences below all stand.

A local server on the phone, serving a page to a laptop on the same network,
is well-trodden — VLC has shipped it for years — but it has three consequences
worth knowing before My Music is reworked around it:

- **It needs native code.** A web view cannot listen on a socket. This is the
  first piece of the product that cannot be JavaScript in a wrapper, and it
  argues for a container that makes writing a small native plugin comfortable.
- **iOS will ask permission for the local network**, and the app must declare
  `NSLocalNetworkUsageDescription` plus its Bonjour service types. That prompt
  is a step in the user's first run and should be asked for at the moment they
  reach for the feature, not at launch.
- **It does not cost the privacy label.** Files move from the laptop to the
  phone and nowhere else; nothing leaves the device for a server of ours.
  *Data Not Collected* stays true, which is worth protecting deliberately.

**The rework it implies** is at the library end, not the parser end. `import/`
— `musicxml.ts`, `part.ts`, `unfold.ts`, some 2,900 lines with tests — reads a
file and is indifferent to where the file came from. `storage/library.ts` and
`pieces.ts` are the part a desktop would drive: list, add, rename, delete. So
the boundary to define first is *what the desktop can ask of the library*, and
`library.ts` is already sitting on that line.

**Meanwhile: do not invest further in the My Music screen on the web app.**
Its four known gaps (tempo marks, `<transpose>`, a real multi-part score, the
long-rest skip) are parser work and still worth doing; the screen around it is
about to change shape.

## The name, the domain, and the things that cannot be changed later

**Brass Master.** Before anything is renamed, two checks worth ten minutes:
search the App Store for near-identical names (Apple rejects lookalikes under
guideline 4.1), and search IP Australia's trade mark register for "Brass
Master" in the relevant classes. Neither is legal advice; both are cheap.

**Reserve the name in App Store Connect early.** Creating the app record
reserves the name before there is anything to upload.

**The bundle identifier can never be changed** once the app is on sale.
Reverse-DNS off the domain being registered, decided at the same time as the
domain, and written down here when it is.

**The domain changes the base path.** `vite.config.ts` derives `base` from
`GITHUB_REPOSITORY`, giving `/BrassFingeringTrainer/`; served from a domain
root it must be `/`. That wants an explicit environment variable rather than
inference, plus a `CNAME` file in `public/` so Pages keeps the domain across
deploys. Small, and better done at the same time as the rename so there is one
disruption rather than two.

**What the rename touches**: the PWA manifest's `name` and `short_name`, the
settings screen's title, `README.md`, and the repository name if wanted — the
Vite base is already read from the environment, which is what made that
possible.

## The order I would take it

1. **The name and the domain**, with the two availability checks first. They
   are the cheapest things on the list and everything else is stamped with
   them.
2. **The build target** — `VITE_TARGET=web|app`, both built by CI, the web one
   still including My Music for now. This is the mechanism the whole split
   rests on, and every later step is easier once it exists.
3. **Decide the runtime tier's fate** (retire, or redefine `FREE_TIER` to
   withhold nothing). Blocked on the player.
4. **The container spike** — the microphone inside the real wrapper, playing
   the reference tone *while* listening, measuring latency and what the audio
   session does to the tone's route. Before the detector, because it can change
   the detector's design.
5. **The cents measurement** on the player's own instrument, which decides
   whether the tuner can promise what it says.
6. **The detector in TypeScript**, against the recordings in `spikefiles/` as
   fixtures, behind `PlayerInput`.
7. **The tuner**, reading `usesFourth` and per-instrument slide data.
8. **My Music's library boundary**, once the sister app's shape is known.

Steps 1 and 2 are worth doing now and are independent of everything else. Step
4 is the one that de-risks the whole paid app and should not wait for a spare
afternoon: everything from step 5 on is built on assumptions it tests.

## Still open, and named so they are not forgotten

- ~~Retire the runtime entitlement tier, or keep it?~~ Retired — decided
  2026-08-18, see `v3-library-plan.md`.
- Paid upfront, or free with an in-app purchase? **Paid upfront is far
  simpler** — no StoreKit, no receipt check, no network, and the privacy label
  stays clean — and it is what the two-build split naturally produces. Not yet
  confirmed.
- iPhone only, or iPad too? The layout already handles tablets, and the
  screenshots tool already photographs them.
- Does the conductor stay free? It is currently ungated in every build and is
  the most distinctive thing here; that was flagged in *Selling it, one day* as
  something that should be a decision rather than an omission, and under
  today's split the answer is plainly yes — it is free, because everything to
  date is.

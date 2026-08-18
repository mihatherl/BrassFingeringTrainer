# The library lives on the phone — the v3 capture and library ruling

Decided by the player on 2026-08-18, in the first session to hold both
workspaces. This settles the one conflict between the two projects' plans —
who owns the music library — and it prunes real work from both roadmaps, so
it is recorded here rather than left to be re-litigated. `app-store-plan.md`
remains the plan for the free/paid split and the build order; this document
rules the library and capture architecture that plan left open.

## The ruling

**From version 3, the phone owns the library. There is no desktop library.**

The paid App Store app holds the user's music as the single source of truth
and serves it VLC-style: a local HTTP server on the phone shows a URL, a
laptop browses to it, and files can be downloaded, edited in a notation
editor (MuseScore or whatever), and uploaded back. One library, in the
player's pocket, with the laptop as a big screen — no sync protocol, no
second source of truth, no desktop application to install beyond a browser.

The generator's desktop service becomes a **stateless converter**: photographs
in, models run, review screen says which bars to look at, corrected MusicXML
file out. It files nothing. Its library, manifest, folder and sync designs
(`../BrassMXMLGenerator/docs/app-integration.md` §§ 4–5) are deprecated —
built as scaffolding for a PWA that could not host anything, and deliberately
not carried forward.

## Why this way round

- **The laptop-owned library was forced, not chosen.** A web page in Safari
  cannot listen on a socket and its storage is IndexedDB, unreachable from
  outside — so pre-native, the laptop was the only thing that *could* serve.
  The native shell removes that constraint, and BFT's own App Store plan
  already assumed the VLC direction ("a local server on the phone, serving a
  page to a laptop").
- **A mirror is a sync protocol wearing a modest name.** The laptop-owned
  design needed a `folder` field and IndexedDB migration in the app, a
  manifest with stable ids and content hashes, re-download-on-change logic,
  and batch import — all to keep two copies agreeing. One owner needs none
  of it.
- **The round trip the player actually wants** — pull a file off the phone,
  fix it, put it back — is native to this direction and contortionist in the
  other.
- **It converges with on-device inference.** The models are ~4.1 M parameters,
  about 4 MB at int8 (`../BrassMXMLGenerator/docs/handover-ml.md` § 8.6). If
  conversion ever moves onto the phone, the desktop vanishes entirely and
  nothing about this architecture changes.

## The loop, end to end

    band hall:  photograph the part with the ordinary camera app
                (the camera roll is the queue — unchanged)
    laptop:     browse to the desktop converter, upload, convert, review;
                correct in MuseScore; download the finished .musicxml/.mxl
    laptop:     browse to the phone's served page, upload the file into
                the library
    phone:      practice from it

At the laptop both pages are plain HTTP on the LAN (the converter on
localhost, the phone's page on its LAN address), so the mixed-content rule
that dominated the old design never arises. The phone still reaches the
converter's capture page by *navigating* to it, exactly as before.

## What this supersedes, and what stands

**Superseded** (do not build):

- `app-integration.md` § 4 — folders in `PieceRecord`, the IndexedDB
  migration, the folder view driven by a desktop mirror.
- `app-integration.md` § 5 — manifest sync, `origin.sha256` re-download,
  batch/bundle import as a sync mechanism.
- `combined-workspace.md` § 6, two entries: *"The laptop serves; the phone
  connects"* stands for **conversion** but no longer describes the
  **library**; *"Folders on both sides"* is void — there is one side.
- The desktop service's library endpoints (`/api/library*`, `/api/manifest`)
  may remain running but get no further investment.

**Standing, unchanged:**

- The seam is a MusicXML file. `prompts/schema-profile.md` is still the
  contract, and generator output is still verified against the shipping
  `importPart`, unmodified.
- The parser never learns about the network; nothing reaches `exercise/` or
  `engine/`.
- Correction is delegated to a notation editor, never built. The review
  screen's honesty about *which bars to look at* is the converter's product
  surface.
- The overlay bundle (`.mxl` carrying score + page photos + bar zones —
  verified importable) still travels as one file; it is indifferent to who
  owns the library.
- The capture page's `<input type="file" capture>` design and everything in
  `app-integration.md` § 2 about mixed content — still true wherever an
  HTTPS page is involved.

## Consequences for BrassTrainerClaude

1. **The runtime entitlement tier is retired.** This answers the question
   `app-store-plan.md` left open. The split is two products from one
   codebase, drawn entirely at build time: `VITE_TARGET=web|app`, paid
   features behind dynamic imports so the web bundle does not contain them,
   both targets built by CI. `FREE_TIER`, `isUnlocked`,
   `constrainToEntitlements` and the locked-control styling go, with their
   tests — deliberately, as a ruling, not by neglect.
2. **My Music stays in the web app until the App Store build is on sale**,
   exactly as `app-store-plan.md` argues: the door sits behind the build
   target from the start, and the web build keeps it until release day. One
   line, one deploy, when there is something to buy.
3. **The container spike gains a second question.** Alongside the microphone
   (reference tone playing while listening), spike the embedded HTTP server
   in the same wrapper: serving a page and accepting an upload while the app
   runs, the `NSLocalNetworkUsageDescription` prompt asked at the moment the
   user reaches for the feature, and what backgrounding does to the socket.
4. **Consider the library becoming real files** in the app's Documents
   directory rather than IndexedDB. iOS then exposes it in the Files app for
   free — AirDrop, iCloud Drive and "email yourself the file" all work with
   the server switched off, and the HTTP server becomes a convenience rather
   than the only door. Decide at v3 design time, not before.
5. The privacy label survives: files move laptop ↔ phone and nowhere else.
   *Data Not Collected* stays true and is worth protecting deliberately.

## Consequences for BrassMXMLGenerator

- No further work on the desktop library, folders, manifest or sync. The
  converter's roadmap is unchanged and unblocked: barline recall first, the
  calibration corpus second (`handover-ml.md` § 8).
- The review flow ends in a **download**, not an "accept into library" —
  the accept step's metadata (title, composer, part name) still matters,
  because the models read no text and the file should leave the converter
  fully named.
- **Licensing is now on the critical path to release, not a footnote.** The
  models are trained on the Essen corpus (CCARH terms: no commercial
  derivative editions). Once transcription is part of what makes a paid app
  worth buying, that gamble is not acceptable — schedule the retrain on
  clean corpora (OpenScore Lieder, CC0; thesession.org) before the paid
  release, not after.

## Open, and named so they are not forgotten

- **The phone server's API is the new contract** — what the laptop page can
  ask of the library (list, download, upload, replace, rename, delete,
  folders or flat). Write it as `CONTRACT.md` at the workspace root *before*
  either side builds to it. The desktop converter does not implement it; a
  laptop browser is the only client.
- Whether the v3 library is files-in-Documents or IndexedDB (point 4 above).
- Whether the converter ever moves on-device, and when that retires the
  desktop entirely.
- App Store review of apps embedding local HTTP servers has ample precedent
  (VLC among them), but verify the current guidelines at container-spike
  time rather than assuming.

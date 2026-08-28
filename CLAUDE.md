# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based WebAR experience (image tracking, not markerless/world tracking) that works on iPhone Safari and Android Chrome with no app install. Uses **MindAR** for computer-vision tracking (WebXR is not an option — Safari on iPhone doesn't support it) and **Three.js** for rendering.

The marker is an illustrated map of Nuquí, Chocó (`public/targets/map.jpg`). When the camera sees it, **four 3D icons appear pinned to the four animals drawn on the map** — whale, guan (pava), crab, turtle. **Tapping an animal is the only way to select one**: it plays that animal's sound, pulses it and lights its halo. There is deliberately no picker bar (it was removed along with a `SwitchModel` use case that existed only to serve it). The four icons are `.glb` models made by the team's 3D designer, in `public/models/`; the sound is Web Audio synthesis, so no audio files are needed. `PrimitiveFactory` still builds a procedural stand-in for every animal — switch a catalog entry back to `ModelSource.primitive(...)` and it runs with no assets at all.

## Commands

```bash
npm install            # slow: pulls in MindAR + TensorFlow.js
npm run dev             # vite --host over HTTPS (required for camera off localhost)
VITE_HTTP=1 npm run dev # same, no TLS — desktop-only inspection (see /verify.html)
npm run build           # vite build
npm run preview         # vite preview --host
npm run typecheck       # tsc --noEmit
npm run compile-target  # public/targets/map.jpg -> public/targets/map.mind
npm run optimize-models # models-src/*.glb -> public/models/*.glb (webp + draco)
```

There is no test suite and no lint script configured.

`npm run dev` prints a LAN address (`https://192.168.x.x:5173`); open that from the phone, not `localhost`. Safari will warn about the self-signed cert — accept via *Show Details → Visit this website*. Debugging requires the physical device: Safari Web Inspector (from a Mac) for iPhone, `chrome://inspect` for Android.

### Verifying without a phone

`/verify.html` (dev-only — `vite build` bundles `index.html` only) mounts **the real `MarkerPin` objects** onto a picture of the map, placed in the exact anchor plane and scale MindAR uses. The orthographic view has no perspective to hide a mistake: if a halo doesn't ring its animal, the catalog coordinates are wrong. Run `VITE_HTTP=1 npm run dev` and open it — the self-signed cert otherwise blocks headless/automated inspection.

`node scripts/preview-spots.mjs '[{"u":0.26,"v":0.22}]' out.jpg` draws crosshairs on the map at given normalized coordinates — use it to measure a new `spot` before putting it in the catalog.

## Architecture

Hexagonal (ports and adapters). The single rule: **dependencies point inward.** Read `README.md` for the full rationale (in Spanish) — the essentials:

```
src/
├── domain/            Pure rules, zero external imports.
│   ├── entities/       ArModel, ArSession, Placement
│   └── value-objects/  ModelId, Scale, Vector3, MarkerSpot, ModelSource, SoundProfile, Stabilization, IconPose
├── application/
│   ├── ports/          TrackingPort, ScenePort, AudioPort, InteractionPort, ModelRepository, AnalyticsPort
│   └── use-cases/       StartArExperience, TransformPlacement, PlayModelSound
├── infrastructure/     MindAR and Three.js live ONLY here.
│   ├── mindar/          MindArRuntime — shared instance, owns the 60fps render loop
│   ├── tracking/        MindArTrackingAdapter
│   ├── rendering/       ThreeSceneAdapter, MarkerPin, IconLoader, PrimitiveFactory
│   ├── interaction/      PointerInteractionAdapter (raycast + gestures)
│   ├── audio/            WebAudioAdapter (synthesis, no audio files)
│   ├── repositories/    StaticModelRepository + NUQUI_CATALOG
│   └── di/container.ts ← composition root
├── ui/                 ArView — paints state, emits intents; knows nothing about MindAR/Three.js
└── verify.ts           Dev-only coordinate check (see above)
```

- **`TrackingPort` is the port that justifies the whole architecture.** MindAR (unmaintained since Jan 2024, single maintainer) is the volatile piece. Swapping it for WebXR/Zappar/8th Wall means writing a new adapter and changing exactly two lines in `src/infrastructure/di/container.ts` (marked with arrows in the file) — domain, use cases, and UI stay untouched.
- `container.ts` is the **composition root**: the only place concrete implementations get wired to ports. Start here to see how everything connects.
- The 60fps render loop is deliberately **not** behind a port (abstracting per-frame matrices was judged not worth the cost); it lives in `MindArRuntime`, and adapters subscribe via `onFrame()`.
- **`MarkerSpot` (domain) + `MarkerPin` (infrastructure) are the pairing this design rests on.** `MarkerSpot` says *"the crab is at (0.487, 0.472) of the image"* — normalized 0–1 from the image's **top-left**, the way you'd measure on the image file. `MarkerPin` translates that into MindAR anchor coordinates and builds the halo, tap zone, and floating icon. `MarkerPin` deliberately **does not depend on MindAR or the runtime**, which is exactly what lets `verify.html` mount the real pins without a camera.
- **Anchor coordinate system** — verified in MindAR's source, not guessed (`image-target/three.js:214-229` and the comment on `controller.js:_glModelViewMatrix`):
  - Origin is the **center** of the marker image; the image **width is 1 unit**, its height is `targetAspect`.
  - **+X** right, **+Y up** (MindAR flips the image's Y with `y' = h - y`), **+Z out of the paper toward the camera**.
  - The conversion lives in one function, `anchorPositionOf`: `x = u - 0.5`, `y = (0.5 - v) * targetAspect`.
- Scene graph hierarchy (needed to follow `ThreeSceneAdapter`):
  ```
  scene → follower (marker pose, SMOOTHED — content never hangs directly off MindAR's anchor)
            └── overlay (global offset)
                  └── MarkerPin ×4 (fixed position = its MarkerSpot)
                        ├── halo (ring lying flat on the paper)
                        ├── tap zone (invisible, generous)
                        └── lift (floats along +Z, bobbing)
                              └── icon (spun and scaled in place)
  ```
  Content is deliberately not parented directly to MindAR's anchor because doing so inherits its raw frame-to-frame tracking jitter. `follower` copies the anchor pose every frame with framerate-independent exponential smoothing instead; the Fast/Balanced/Stable button changes that smoothing factor live.
- **Rotation and scale never move an icon off its animal.** `Placement.rotationY`/`scale` spin and resize each icon *in place*; a change that makes them displace the icons is a bug, not a feature. `Placement.offset` moves the whole overlay and is currently always zero.
- `ArSession` (in `domain/entities/ArSession.ts`) is a frozen state machine (`idle → preparing → searching → tracking/lost → error`) with guarded transitions — invalid states (e.g. `tracking()` without a prior `Placement`) throw. `TransformPlacement`/etc. read/write this via the use cases, never by mutating fields directly.
- Path aliases (`@domain`, `@application`, `@infrastructure`, `@ui`) are defined in both `tsconfig.json` and `vite.config.ts` — keep them in sync if either changes.

## Project-specific gotchas (read before touching related code)

- **`WebAudioAdapter.unlock()` must be called synchronously inside the Start button's click handler** (see `StartArExperience.execute`). iOS Safari keeps the `AudioContext` suspended forever if unlock happens outside a real user gesture. Don't move audio unlocking behind an `await` chain or into a different handler.
- **`three` is pinned to `0.160.0`** — the version MindAR's docs were verified against. Do not bump it without testing on a real device; MindAR has never been tested against newer Three.js releases.
- **`src/types/mindar.d.ts` is hand-written**, not official types — names were verified against the actual `mind-ar@1.2.5` bundle, not against a spec.
- `.npmrc` sets `ignore-scripts=true`, so install-time scripts (postinstall, etc.) are skipped for all dependencies. **This is why the target compiler is hand-rolled:** MindAR's own `OfflineCompiler` imports the native `canvas` package, which never gets built here. `scripts/compile-target.mjs` subclasses `CompilerBase` (which has no canvas dependency) and feeds it a jpeg-js-decoded buffer through a two-method canvas shim. Don't "fix" it by adding `canvas` — it needs a native toolchain on Windows.
- **Models are a two-folder pipeline: `models-src/` (the designer's originals, not served) → `npm run optimize-models` → `public/models/` (what ships).** Never optimize in place: texture compression is lossy, so re-running over its own output degrades quality a little each time. The delivered originals were 8.4 MB and 96–99 % of that was **textures**, not geometry — so the thing that cuts weight is WebP re-encoding, not Draco (which three of the four already had). The script does both anyway and lands at 3.2 MB. Both folders are committed: Netlify runs `npm run build` only, so `public/models/` must already hold the optimized files.
- **`view` and `iconSize` in the catalog are per-animal on purpose.** The whale and the guan are drawn in profile on the map and are unrecognisable from above, so they use `view: 'side'`; the crab and turtle are drawn in plan and stay `'top'`. `MarkerPin.applyView` is the single place that turns that into a rotation. A whale also can't be the size of a crab — hence `iconSize`, a multiplier over `ICON_TARGET_SIZE` applied in `IconLoader`.
- **`TARGET_ASPECT` in `src/main.ts` must match the compiled image**, and the catalog's `spot` values are measured against that same image. Changing the map means: re-run `npm run compile-target`, update `TARGET_ASPECT`, and re-measure all four spots. They are one unit, not three independent settings.
- **The tap raycast resolves *which* icon was hit**, via a `userData.modelId` set on each pin group and walked up from the hit mesh (`findModelId`). The tap zone uses `opacity: 0` rather than `visible: false` on purpose: three's raycaster still traverses invisible objects, so `visible: false` would not have made it untappable — but it also wouldn't have been reliable across versions.
- **`IconLoader` is the only place a model becomes an `Object3D`**, shared by `ThreeSceneAdapter` and `verify.html` so the verification page tests the real assets. It also owns the two things every incoming `.glb` needs:
  - **Normalization (`fitToIconSize`).** **Map width = 1 unit**, so a `.glb` authored in Blender units or metres is enormous — the delivered models are 9–23 units across. `fitToIconSize` recentres each model on its bounding box and scales its longest side to `ICON_TARGET_SIZE` (0.21, the size `PrimitiveFactory` draws to), so real and procedural icons are interchangeable and no per-model `defaultScale` tuning is needed. It returns a **wrapper** group: `MarkerPin` overwrites `icon.scale`/`icon.rotation` every frame, so the fit factor must live on an inner node or it gets wiped.
  - **Draco.** The models ship `KHR_draco_mesh_compression` in `extensionsRequired`. `public/draco/` holds the decoder copied from `three@0.160.0`; re-copy it if three is ever bumped. `EXT_texture_webp` (also required by these files) needs no setup — three 0.160 supports it natively.
- If a `.glb` is missing or fails to load, that model falls back to a grey disc instead of crashing the session — this is intentional, don't add a try/catch that hides the failure differently. A grey disc on screen means *check the console for `[IconLoader]`*, usually a codec the loader wasn't configured for.
- To swap an icon for a different asset: change its `source:` entry in `NUQUI_CATALOG` and drop the file in `public/models/`. Icons are modeled **+Y up** (Three.js's natural orientation); `MarkerPin` rotates the containing group 90° about X so that up becomes "out of the map".
- **`MarkerPin.dispose()` frees textures, not just materials.** `material.dispose()` deliberately leaves textures alone (three treats them as shared), so with textured `.glb`s every `clear()` would leak several MB of GPU memory without the explicit walk.

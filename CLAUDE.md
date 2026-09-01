# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based WebAR experience (image tracking, not markerless/world tracking) that works on iPhone Safari and Android Chrome with no app install. Uses **MindAR** for computer-vision tracking (WebXR is not an option — Safari on iPhone doesn't support it) and **Three.js** for rendering.

The marker is an illustrated map of Nuquí, Chocó (`public/targets/map.jpg`). When the camera sees it, **four 3D icons appear pinned to the four animals drawn on the map** — whale, guan (pava), crab, turtle. **Tapping an animal is the only way to select one**: it plays that animal's sound, pulses it and lights its halo. The UI is deliberately down to **two buttons — Start and «?»**; a picker bar and the rotate/scale/stabilization controls were removed as visual noise (the picker took a `SwitchModel` use case with it). On start, an overlay guide (`#guide`) shows a viewfinder frame in the map's exact 880:1280 proportion plus "Apunta al mapa de Nuquí"; it auto-hides after a few seconds, «?» brings it back until the marker is found, and drag/pinch gestures still rotate and scale. The four icons are `.glb` models made by the team's 3D designer, in `public/models/`; the sound is Web Audio synthesis, so no audio files are needed. `PrimitiveFactory` still builds a procedural stand-in for every animal — switch a catalog entry back to `ModelSource.primitive(...)` and it runs with no assets at all.

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
npm run bench-detection # measures how well a .mind survives glare (no camera)
```

There is no test suite and no lint script configured. `npm run bench-detection` is
the closest thing: it runs MindAR's real `Detector` + `Matcher` against synthetic
frames of the map under increasing glare and distance, and reports both hits and
**inlier counts**. Compare two `.mind` files with it before believing any claim
that detection got better — pass/fail alone flips on noise near the threshold,
the inlier total is the signal.

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
                        └── lift (floats along +Z, bobbing; height adapts
                              so a deep icon never sinks under the paper)
                              └── icon (spun and scaled in place)
  ```
  Content is deliberately not parented directly to MindAR's anchor because doing so inherits its raw frame-to-frame tracking jitter. `follower` copies the anchor pose every frame with framerate-independent exponential smoothing instead. The smoothing level is fixed at `Stabilization.default()` — the Fast/Balanced/Stable button was removed from the UI, but `StartArExperience.applyStabilization` is still there if a control is ever wanted back.
- **Rotation and scale never move an icon off its animal.** `Placement.rotationY`/`scale` spin and resize each icon *in place*; a change that makes them displace the icons is a bug, not a feature. `Placement.offset` moves the whole overlay and is currently always zero.
- `ArSession` (in `domain/entities/ArSession.ts`) is a frozen state machine (`idle → preparing → searching → tracking/lost → error`) with guarded transitions — invalid states (e.g. `tracking()` without a prior `Placement`) throw. `TransformPlacement`/etc. read/write this via the use cases, never by mutating fields directly.
- Path aliases (`@domain`, `@application`, `@infrastructure`, `@ui`) are defined in both `tsconfig.json` and `vite.config.ts` — keep them in sync if either changes.

## Project-specific gotchas (read before touching related code)

- **`WebAudioAdapter.unlock()` must be called synchronously inside the Start button's click handler** (see `StartArExperience.execute`, where it is the first statement in the `try`, before any `await`). iOS Safari keeps the `AudioContext` suspended forever if unlock happens outside a real user gesture. Don't move audio unlocking behind an `await` chain or into a different handler — what matters is where the call *starts*, not where its promise is awaited.
- **Envelope floors, not `durationMs`, decide how long a sound is actually heard.** An exponential ramp down to ~0 crosses four decades: half way through it is already at ~1% of the peak, so a 220 ms profile was audible for about 20 ms and taps felt mute. The bus decays to 4% of peak (−28 dB) and the overtone gains to 10% of their weight — the two envelopes multiply, so both have to stay off zero. Verified by rendering the real adapter through an `OfflineAudioContext` and measuring: audible time roughly tripled (whale 231 → 726 ms, crab 23 → 75 ms) with peaks near 0.5 and no clipping.
- **`three` is pinned to `0.160.0`** — the version MindAR's docs were verified against. Do not bump it without testing on a real device; MindAR has never been tested against newer Three.js releases.
- **`src/types/mindar.d.ts` is hand-written**, not official types — names were verified against the actual `mind-ar@1.2.5` bundle, not against a spec.
- `.npmrc` sets `ignore-scripts=true`, so install-time scripts (postinstall, etc.) are skipped for all dependencies. **This is why the target compiler is hand-rolled:** MindAR's own `OfflineCompiler` imports the native `canvas` package, which never gets built here. `scripts/compile-target.mjs` subclasses `CompilerBase` (which has no canvas dependency) and feeds it a jpeg-js-decoded buffer through a two-method canvas shim. Don't "fix" it by adding `canvas` — it needs a native toolchain on Windows.
- **Models are a two-folder pipeline: `models-src/` (the designer's originals, not served) → `npm run optimize-models` → `public/models/` (what ships).** Never optimize in place: texture compression is lossy, so re-running over its own output degrades quality a little each time. The delivered originals were 8.4 MB and 96–99 % of that was **textures**, not geometry — so the thing that cuts weight is WebP re-encoding, not Draco (which three of the four already had). The script does both anyway and lands at 3.2 MB. Both folders are committed: Netlify runs `npm run build` only, so `public/models/` must already hold the optimized files.
- **All four animals use `view: 'front'`** — upright on the map, facing whoever holds the phone; the drag gesture turns them sideways. `'top'` (lying on the paper, seen from above) and `'side'` (profile) still exist in `IconView` and are the vocabulary for changing one animal's presentation: it is a word in the catalog, not a change to `MarkerPin`. `facing` (degrees of yaw about the icon's own up-axis) is 0 for all four now, but it is what let the whale and turtle be turned to match their drawings when they were in profile — keep it.
  **Calibrate `iconSize` in `/verify.html` by measuring on screen, never analytically.** The on-screen size is *not* `ICON_TARGET_SIZE × iconSize`: `fitToIconSize` normalises the model's largest 3D dimension, and which dimension ends up across the screen versus pointing at the camera depends on `view` and `facing`. Facing forward the whale is foreshortened (its length runs toward the viewer) and the turtle is low and wide, so both need much larger `iconSize` than the guan to read at a comparable size. Measured silhouette widths, in map widths: whale 0.30, turtle 0.26, guan 0.22, crab 0.17.
- **`MarkerPin` lifts each icon by however much it needs, not by a fixed height.** Facing the camera, a long animal extends *out of the paper* rather than across it, so a fixed `HOVER_HEIGHT` would bury the whale's back half under the map, sliced by the paper plane. `measureHalfDepth` measures the oriented icon once at construction and `sync` flies it at `max(HOVER_HEIGHT, halfDepth × scale + CLEARANCE)`. Flat icons are unaffected; the whale ends up noticeably higher, which is the visible cost of facing forward.
- **MindAR's compiler and its runtime disagree about greyscale, and `scripts/compile-target.mjs` reconciles them.** `CompilerBase` flattens colour with a plain mean `(R+G+B)/3`, but on the phone `input-loader.js` converts each camera frame with Rec.601 luma (`0.299R + 0.587G + 0.114B`) in a shader. Compiled naively, the descriptors in the `.mind` describe an image the camera never produces — a costly mismatch on a map this saturated, where blue counts three times more in the compiler than on the device. The script pre-bakes luma into all three channels before handing pixels to the compiler, so the compiler's mean returns exactly the shader's signal. Measured with `npm run bench-detection`: 8/12 → 9/12 frames detected and 234 → 282 total inliers, at zero runtime cost and identical file size. **Any `.mind` compiled before this fix should be recompiled.**
- **`TARGET_ASPECT` in `src/main.ts` must match the compiled image**, and the catalog's `spot` values are measured against that same image. Changing the map means: re-run `npm run compile-target`, update `TARGET_ASPECT`, and re-measure all four spots. They are one unit, not three independent settings.
- **MindAR always inserts a CSS3D layer over the WebGL canvas, and it eats every tap.** `MindARThree` builds a `CSS3DRenderer` whether or not you use CSS anchors and appends it *after* the canvas (`three.js:42-43`), so its full-screen `<div>` sits on top. three sets `pointerEvents: 'none'` on the inner `viewElement` but **not** on that outer div, and a transparent div swallows pointer events exactly like an opaque one — `document.elementFromPoint()` at the screen centre returned the div, never the canvas, so the raycast never ran and tapping an animal did nothing at all. `MindArRuntime.configureRenderer` now sets `pointerEvents = 'none'` on it. If taps ever go dead again, check that first, not the raycast.
- **The tap raycast resolves *which* icon was hit**, via a `userData.modelId` set on each pin group and walked up from the hit mesh (`findModelId`). The tap zone uses `opacity: 0` rather than `visible: false` on purpose: three's raycaster still traverses invisible objects, so `visible: false` would not have made it untappable — but it also wouldn't have been reliable across versions.
- **`IconLoader` is the only place a model becomes an `Object3D`**, shared by `ThreeSceneAdapter` and `verify.html` so the verification page tests the real assets. It also owns the two things every incoming `.glb` needs:
  - **Normalization (`fitToIconSize`).** **Map width = 1 unit**, so a `.glb` authored in Blender units or metres is enormous — the delivered models are 9–23 units across. `fitToIconSize` recentres each model on its bounding box and scales its longest side to `ICON_TARGET_SIZE` (0.21, the size `PrimitiveFactory` draws to), so real and procedural icons are interchangeable and no per-model `defaultScale` tuning is needed. It returns a **wrapper** group: `MarkerPin` overwrites `icon.scale`/`icon.rotation` every frame, so the fit factor must live on an inner node or it gets wiped.
  - **Draco.** The models ship `KHR_draco_mesh_compression` in `extensionsRequired`. `public/draco/` holds the decoder copied from `three@0.160.0`; re-copy it if three is ever bumped. `EXT_texture_webp` (also required by these files) needs no setup — three 0.160 supports it natively.
- If a `.glb` is missing or fails to load, that model falls back to a grey disc instead of crashing the session — this is intentional, don't add a try/catch that hides the failure differently. A grey disc on screen means *check the console for `[IconLoader]`*, usually a codec the loader wasn't configured for.
- To swap an icon for a different asset: change its `source:` entry in `NUQUI_CATALOG` and drop the file in `public/models/`. Icons are modeled **+Y up** (Three.js's natural orientation); `MarkerPin` rotates the containing group 90° about X so that up becomes "out of the map".
- **`MarkerPin.dispose()` frees textures, not just materials.** `material.dispose()` deliberately leaves textures alone (three treats them as shared), so with textured `.glb`s every `clear()` would leak several MB of GPU memory without the explicit walk.

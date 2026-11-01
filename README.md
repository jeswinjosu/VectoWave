# VectoWave — motion studio for SVG

Import an SVG, clean it up and reshape it point by point, animate it on a timeline, give it Idle / Hover / Pressed states, and export it as **animated SVG, Lottie JSON, dotLottie or WebM video**.

React 18 + TypeScript · Tailwind CSS (OKLCH tokens) · Zustand + Immer · Lucide icons · fflate · mediabunny (WebM encoding, loaded on demand).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build → dist/
```

Deploying to GitHub Pages: push to `main`; `.github/workflows/deploy.yml` builds and publishes `dist/` (Settings → Pages → Source: GitHub Actions).

## Start screen

Opening the app shows the animated VectoWave logo and three cards, each with a live preview:

- **Continue previous work**: the document you were last editing, restored from this browser.
- **New blank document**: a 512 × 512 artboard with Idle, Hover and Pressed states.
- **Open demo**: an animated badge with a hover morph and a press state.

File → Home Screen (or clicking the logo) returns to it.

### Autosave

The document is saved to IndexedDB (localStorage fallback) about half a second after each edit and whenever the tab is hidden or closed. Saving starts with your first edit, so opening the demo or a blank document never overwrites earlier work. The top bar shows the last save time. Use File → Save Project to keep a `.vwave.json` file as well.

## Workspace

| Area | What it does |
| --- | --- |
| Top bar | Menus (File, Edit, View, Animation, Help), undo/redo, document name, autosave status, Preview, Export. |
| Toolbar | Select & transform (V) · Sub-select anchors (A) · Pen (P) · Rectangle (R) · Ellipse (O) · Hand (H) · zoom · grid · pixel snap. |
| Canvas | Infinite pan (Space+drag), wheel zoom, grid, transform box with scale/rotate handles, **draggable origin (pivot)**, marquee, anchor/handle editing. |
| Inspector | Transform, appearance and path properties with per-property keyframe diamonds, anchor handle modes, simplification, easing editor. |
| Timeline | State tabs, transport, zoomable ruler, layer tree with drag-to-reorder, property tracks, draggable keyframes. |
| State Machine | Graph + rules for hover / press / click / custom triggers, live preview console. |

### Moving the origin point

With the Select tool, drag the pivot crosshair inside the selection box. Only the origin moves: the position (and every position keyframe) is compensated so the artwork stays where it is. The pivot snaps to the content's centre, corners and edge midpoints; hold **Alt** to place it freely. The Origin X/Y fields and the "centre origin" button use the same compensation.

## Export

| Format | When to use it | Notes |
| --- | --- | --- |
| Animated SVG | Websites: smallest file, sharp at any size, hover/press without JavaScript. | CSS keyframes + SMIL path morphs; Hover → `:hover`, Pressed → `:active`. |
| Lottie JSON | Apps that already use a Lottie player (iOS, Android, React Native, web). | One file per state: `<name>.json` (start state), `<name>.<state>.json`; "All states (.zip)" downloads them together. |
| dotLottie | Interactive Lottie in one compressed file. | dotLottie v2 container: `manifest.json`, `a/<state>.json`, `s/main.json` state machine. |
| WebM video | Social posts, slides, video editors. Not interactive or scalable. | Rendered frame-by-frame on your device (WebCodecs VP9/VP8), 512–1440 px, 24–60 fps, optional transparent background. Needs a recent Chrome, Edge or Firefox. |

Each option in the Export window shows its file size (WebM shows an estimate until rendered).

## Theme

The workspace uses a fixed OKLCH palette taken from the logo: deep navy `#09122A` surfaces and lime `#BCF855` accents, with aqua for handles and pivots (`src/lib/theme.ts`).

## Project structure

```
src/
├─ types/model.ts              Document model
├─ lib/
│  ├─ path.ts, simplify.ts     Path parsing/serialising, Bezier maths, Douglas–Peucker + curve fitting
│  ├─ svgImport.ts             SVG import & cleanup
│  ├─ animation.ts, easing.ts  Keyframe evaluation and easing
│  ├─ runtime.ts               State-machine runtime for preview
│  ├─ autosave.ts              IndexedDB autosave
│  ├─ theme.ts                 Brand palette
│  └─ exporters/               animatedSvg, lottie, packages (dotLottie + Lottie zip), webm, frame
├─ store/                      Editor store (undo history, actions incl. setOrigin) + preview loop
└─ components/
   ├─ intro/                   Start screen + live previews
   ├─ brand/Logo.tsx           Vector logo (animated variant for the start screen)
   ├─ canvas/ timeline/ inspector/ statemachine/ modals/ ui/
```

## Known limitations

- Gradients are flattened to an averaged solid colour; `<text>`, `<image>`, clip paths, masks and filters are skipped on import.
- Animated SVG: switching states is instant (no blend); overshoot easing is clamped for SMIL morphs.
- WebM transparency depends on the browser's VP9 encoder supporting alpha.

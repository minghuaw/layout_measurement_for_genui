# BACKLOG — deferred rule/measurement ideas

Recorded 2026-09-09, after the four cloud-stage r0.1 repair rounds. Purpose:
keep "why it was deferred / how it could be done" recoverable across context
losses. Historical note: the open ideas scattered in `steven/NOTES.md`
(pre-scroll image-load pass etc.) are superseded by this file.

## A. Deferred rule ideas

### A1. OVERLAP refinement (precise image-covered detection) — IMPLEMENTED as `IMG_COVERED` (L1, layer-basic.mjs): solid-opaque covers (bgOwn, non-gradient, alpha>=0.5) of >=30% of an img, same-container later/positioned siblings + global fixed/sticky, ancestor-excluded. Remaining gap: cover descendants, stacking contexts, scroll-state (see B).
Basic geometric overlap is already covered by the existing `OVERLAP` rule
(L1, same-container sibling pairs) — the toilet baseline's
`img 与 div 重叠 375×176px` was its hit. Three structural blind spots remain:
1. **Cross-container / positioned covers**: the pair runner only checks
   siblings within one container; a `fixed`/`absolute` header overlaying a
   hero in a *different* subtree is invisible (the toilet sticky-header-over-
   image visual is this class).
2. **Opacity awareness**: OVERLAP cannot distinguish an opaque block covering
   an image (harmful) from a translucent gradient scrim placed for text
   legibility (legitimate design — the hainan/toilet hero pattern; today it
   false-positives on those).
3. **Image-area threshold**: MIN_W×MIN_H intersection vs "% of the image
   area covered".

Feasible approach — `IMG_COVERED` rule: for each `<img>`, check **later
siblings in the same container + any non-static positioned element** whose
rect intersects ≥30% of the image rect, with covering-element effective
background alpha > ~0.5 (translucent scrims auto-exempt). COLLECT already
captures rect/position/background alpha — no new collection needed.

### A2. IMG_CLIPPED (image cut by overflow) — low priority, high false-positive risk
`object-fit: cover` intentional cropping is the mainstream pattern (heroes,
thumbnails) and is nearly indistinguishable from harmful clipping at the DOM
level. The generation-side prompt red-line ("do not clip image subjects with
overflow:hidden") already covers the generated-page case. If detection is
ever pursued, restrict to imgs **without object-fit whose rendered aspect
ratio ≠ naturalWidth/naturalHeight ratio** (a distortion signal — see A4,
shares data).

### A3. Interaction-affordance rule `AFFORDANCE_MISMATCH` (user-scheduled for a future experiment)
"Looks clickable but isn't": computed `cursor: pointer` (or hover styling)
on an element that is not `a/button/[role=button]/[contenteditable]` and has
no `tabindex`.
**Key limitation**: React synthetic events attach listeners at the root —
the DOM shows no `onclick`, so handler presence is undetectable. The rule
must therefore be phrased as an a11y-semantics issue ("pointer affordance
without interactive semantics — unreachable for assistive tech"), not
"isn't clickable".

### A4. IMG_DISTORTED (aspect distortion)
`naturalWidth/naturalHeight` ratio vs rendered box ratio mismatch beyond a
tolerance → stretched/distorted image. Img nodes are already collected;
adding natural-size capture is the only prerequisite. Shares data with the
safe subset of A2.

## B. Detection techniques (engine capabilities, for future investigations)

### B1. Clip detection
- **Ancestor clip-rect accumulation**: an element's visible rect = its
  border-box ∩ every ancestor clip rect (`overflow: hidden/clip/auto/scroll`).
  COLLECT's walk already carries parent context top-down — accumulate the
  clip rect along the way; no extra capture pass needed.
- **CDP `DOM.getContentQuads`**: returns content quads **after ancestor
  clipping** — comparing against the border-box quad directly quantifies
  "how much of this element is actually visible". Cheapest engine-native
  option (tool mode has no CDP session today; `--full` mode already opens
  one for DOMSnapshot and could add it).
- `element.checkVisibility()` (recent Chromium) as a cross-check.

### B2. Scroll-state detection
- `getBoundingClientRect` is viewport-relative — **re-capture after
  scrolling** (a scroll pass: extremes of each scroll container, or N steps)
  reveals the real coverage of sticky/fixed elements. The same pass doubles
  as the lazy-image pre-scroll load trigger (proposed back in the steven era).
- **Static approximation without scrolling**: a `fixed` element overlaps
  whatever scrolls beneath it by construction; a sticky element covers its
  container's scroll range. Suggested flag criterion: "covered at rest" or
  "covered across the entire scroll range" (transient pass-through coverage
  is normal design).

### B3. Known limits (design intent vs defect — inherently hard)
- `object-fit: cover` intentional crops, translucent scrims, corner
  badges/watermarks over images are all legitimate patterns — any
  covering/clipping rule needs area thresholds + alpha exemptions +
  position whitelisting to suppress false positives.
- Purely aesthetic judgments (a scrim washing out an image, visual imbalance)
  → screenshot/vision direction (cross-ref Widget-Anything stage-1 notes).

## C. Environment debt (non-rule; don't trust the gate until fixed)

- `npm run build`'s eslint stage is **broken out of the box** in all four
  project repos: `eslint/ts.mjs|react.mjs|data-source.mjs` are imported by
  `eslint.config.mjs` but never shipped (the `eslint/` directory is empty).
  Working verification gate until then: `npx tsc --noEmit` +
  `npx vite build`. Fixing it is scaffold completion, not this repo's job.

# BACKLOG — deferred rule/measurement ideas

Recorded 2026-09-09, after the four cloud-stage r0.1 repair rounds. Purpose:
keep "why it was deferred / how it could be done" recoverable across context
losses. Historical note: the open ideas scattered in `steven/NOTES.md`
(pre-scroll image-load pass etc.) are superseded by this file.

## A. Deferred rule ideas

### A1. OVERLAP refinement — RESOLVED (2026-09-09): upstream PR #2 merged (exemption-based OVERLAP v1.2: EXEMPT_POS positioned-layering + MIN_AREA_PCT 10% small-area), closing all 7 challenge FPs; complemented by `MEDIA_COVERED` (L1, layer-basic.mjs, renamed from IMG_COVERED): rich-media (img/video/canvas/svg/iframe/object/echarts containers + url-background divs) covered >=30% by solid-opaque elements, same-container later/positioned siblings + global fixed/sticky, ancestor-excluded. Remaining gaps: cover descendants, stacking contexts, scroll-state (see B), bg-cover-crop (see A2 note).
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
**Acceptance fixtures**: `fixtures/fp-*.html` (7, from the OVERLAP_challenge
set) — golden-pinned known false positives; when this refinement lands, the
fp-* OVERLAP entries dropping from the snapshot diff IS the verification.
(Provenance note: the OVERLAP_challenge README's suggested
`run.mjs --fixture-dir` flag does not exist in this analyzer — the cases are
wired via the standard run.mjs ALL / golden.mjs NAMES lists.)

### A2. IMG_CLIPPED (image cut by overflow) — low priority, high false-positive risk
**Observed root cause (reading project, 2026-09-09)**: the harmful clipping
seen in practice is `object-fit: cover` **center-cropping** — scenario images
with content baked in at the top (text/labels: 起床/早餐/出行/睡前) lose it to
the symmetric crop. Detection would be feasible without content-vision:
box-aspect vs `naturalWidth/Height`-aspect yields the exact clipped
fraction/pixels, and `alt` presence discriminates content images (alt set)
from decorative ones (alt="" → exempt); remedy = `object-position` / container
aspect. Deferred as context only — no rule drafted; broken-image placeholders
(the IMG_BROKEN alt suggestion) sidestep the crop case entirely.
`object-fit: cover` intentional cropping is also the mainstream pattern
(heroes, thumbnails) and is nearly indistinguishable from harmful clipping at
the DOM level for the overflow-hidden variant. The generation-side prompt
red-line ("do not clip image subjects with overflow:hidden") already covers
the generated-page case. If detection is ever pursued, restrict to imgs
**without object-fit whose rendered aspect ratio ≠ naturalWidth/naturalHeight
ratio** (a distortion signal — see A4, shares data).

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

### A5. TEXT_COVERED (cross-container text covering) — IMPLEMENTED (2026-09-09, L1 warn, layer-basic.mjs): geometric coverScan shared with MEDIA_COVERED — paint model = positioned elements paint above static content; victim anchor = nearest positioned ancestor (hainan round-0 relative-hero-over-static-h1 is the demonstrated TP); candidates = positioned elements with tree-order seq > anchor. The straddle variant (text visually on top, crossing a media boundary) and overflow-clipping remain covered by A2/A6 notes.
The one gap the refined OVERLAP v1.2 (same-container pair runner) cannot see:
`fixed`/`sticky` elements from **other subtrees** visually covering text at
scroll-0 (the original toilet sticky-topbar-over-image complaint class).
Trigger for building it: a real cross-container text-obscuring case appearing
in experiment rounds. Implementation is a small delta on the existing
`MEDIA_COVERED` DFS — the global fixed/sticky candidates pass already exists;
add text-bearing victims (direct `n.text`) with the same ≥30% solid-opaque
test. Note: the opaque-cover test deliberately does **not** transfer to
click-blocking (a transparent `pointer-events:auto` overlay blocks clicks
while looking like nothing) — that's why INTERACTIVE_BLOCKED stays a separate
deferred idea.

### A6. Minor polish — COLOR_DOMINANCE contributor dedupe
The contributor list can emit identical entries (reading home:
`button@y656(4%)` ×3 — three same-y carousel buttons). Candidate fix: merge
identical label+hex contributors (summing shares) or add a distinguishing
anchor (x or per-card testid) so each contributor is uniquely identifiable.

### A7. RADIUS_SCALE_OFF — pill/circle false signal (deferred; caused a real regression)
**Observed (workout/kitchen r0.2, 2026-09-10)**: the rule flags `999px`/`9999px`
as off-scale, so models "fix" the shared `--radius-full`/`--radius-pill` token by
clamping it to `24px`. Small pills stay round (CSS clamps to half the side), but
any element **larger than ~48px** turns from a circle into a rounded square
(workout home `RunLane` 180×180 dial: computed `999px → 24px`); because the token
is shared, the regression reaches pages the round never touched.
Candidate fix: exempt "fully rounded" radii in `RADIUS_SCALE_OFF`
(`layer-order.mjs`) — skip nodes where `radius >= min(w,h)/2` (or a large
sentinel ≥100px), mirroring the scroll-region exemption now in the overflow
rules. Deferred from the 2026-09-10 SIZE_INCONSISTENT/TEXT_CLIP change set;
affects recorded r0.2 for hainan/workout/reading/kitchen (pill token clamped).

### A8. GRADIENT_CONTRAST — worst-stop false positives on decorative stripe gradients
**Observed (decor family-guide r0.2, 2026-09-10)**: the model replaced solid section
backgrounds with a 3px accent stripe expressed as a gradient
(`linear-gradient(90deg, var(--danger) 3px, var(--surface) 3px)`). `GRADIENT_CONTRAST`
then fired **52 times**, each using the **worst stop** (the 3px `--danger`/`--accent`
stripe) as the text background — even though the text sits on the `--surface` part
(after the 3px). The rule's stop model ignores **stop extent / position**, so a
decorative left-edge stripe is treated as a full-width background.
Candidate fix: when computing the worst-case stop, weight by the stop's **area/extent**
along the gradient (skip stops whose band doesn't underlie the text rect), or exempt
gradients whose non-neutral stops occupy < ~10% of the box. Related: the same
stop-extent gap can over-report on gradient scrims. Recorded as a deferred item; the
decor family-guide r0.2 result (54) is dominated by this FP class.

### A9. RESOLVED (2026-09-10) — gradient overlay covering text (undetected issue #1, decor)
`coverScan` excluded gradient backgrounds (`!c.gradient` in `isOpaque`), so a positioned
fade-to-bg scrim overlaying **static** text was never a cover candidate — the decor home
`p` "200㎡ 三代同堂…" under `linear-gradient(180deg, transparent 40%, var(--bg) 100%)`
was neither reported nor fixed. Fix: `parseGradInfo` (collect.mjs) captures the gradient
direction + **raw** stop positions/alpha (including the `color(srgb …)` form browsers emit
for `color-mix`); `coverScan({ allowGradient: true })` — **TEXT_COVERED only** — treats a
gradient as a cover when the victim's span projected onto the gradient axis is
≥ `MIN_COVER` opaque (non-axis-aligned / no positions → skipped). `MEDIA_COVERED` keeps
gradients excluded (image + legibility scrim is intentional). Fixtures:
`tp-gradient-scrim-cover`, `fp-scrim-above-text`, `fp-translucent-scrim`.

### A10. RESOLVED (2026-09-10) — page background chain + positioned background-layer resolution
Two related `CONTRAST_LOW` FP classes closed:
1. **Page base bg ignored** — `walk` started at `body.children` with a white base, so pages
   setting the background on `html`/`body` (no wrapper) measured text against white
   (`body { background:#1e2a23; color:#ede3d0 }` → light-on-white FP). Fix: base =
   white → html bg → body bg (alpha composited); `pageInfo.bodyBg` re-aligned to the same
   composite; body gradient stops seeded as the initial `parentStops` (body-gradient
   inheritance). Fixtures `tp-body-bg-dark-text` / `tp-body-bg-gradient`.
2. **Positioned background-layer sibling not seen** — a node inside
   `.card > .bg(abs,inset:0) + .body(rel,z-index)` resolved its bg to the ancestor chain
   (body), not the `.bg` layer; exposed by fix 1 on `fp-absolute-layering`
   (`#6b7280` on `#f5f6fa` = 4.48 vs 4.83 on `#fff`). Fix: the walk tracks the most recent
   positioned sibling with a background (solid/gradient/media) covering ≥80% and uses its
   effective bg/stops for later positioned siblings. `fp-absolute-layering` now resolves the
   card text to `#fff` (no FP) and the section text to its gradient (`GRADIENT_CONTRAST`, TP).
   Side effect: `fp-hero-overlay` / `fp-gradient-overlay-card` move `CONTRAST_LOW` →
   `GRADIENT_CONTRAST` (text now correctly resolves to the gradient layer); the residual
   there is the A8 worst-stop limitation (text sits at the dark end). Multi-layer scrim
   compositing (scrim over an image layer) is approximated (last layer wins).

### A8. RESOLVED (2026-09-11) — GRADIENT_CONTRAST position-aware (worst-stop FPs eliminated)
`GRADIENT_CONTRAST` used the **worst stop** across the gradient regardless of where the
text sits — a 3px decorative stripe (`linear-gradient(90deg, var(--accent) 3px, …)`) or a
gradient's light end fired on text that visually sits elsewhere (decor family-guide r0.3:
26 hits). Fix: the walk now propagates the gradient **geometry** (`_gradGeom`: deg + raw
stop positions + the gradient element's rect, own-or-inherited like `gradStops`), and the
rule samples the gradient color at the **text box's two boundary extremes along the
gradient axis** (general projection via the CSS gradient-line formula, handling any angle
and coincident stops), using the worse contrast of the two. Radial/unparsed gradients fall
back to worst-stop. Fixtures `fp-gradient-stripe-text` (stripe → no fire) /
`tp-gradient-text-spans` (text straddling a low-contrast region → fires).

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

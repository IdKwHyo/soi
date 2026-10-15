# Premium flow polish — 15 October 2026

The retained Version C presentation remains the canonical full and simulated
experience. This pass applies Build Router with Frontend UI Engineering,
Apple Design, focused module design, and Sites delivery.

## Evaluation and changes

1. Menu editing had an abrupt context change. Merchant dish photos and names
   now open a focused editor; the photo carries into the native dialog and
   returns on close when the source is still visible. Bulk editing/imports
   remain available. A single edit merges into the full catalog only after
   checking that the catalog has not changed; it cannot erase other dishes,
   recipes or historical order snapshots.
2. Receipt and ingredient evidence previously appeared simultaneously without
   a visual explanation. The existing AI demo now has a user-controlled
   receipt → ingredient → plate-cost sequence with replay, individual stages,
   and Show all. It uses the visible fictional evidence and existing generated
   dish image. The THB9 value is explicitly the chicken component per plate,
   pending review; playback never confirms evidence or makes model calls.
3. Native dialogs share a short arrival and subtle workspace recession.
   Shared-image decoration uses a manual top-layer popover, with a static
   photo fallback when unsupported. Close, Escape, save and focus stay native
   and synchronous. Interrupted flights restore their original inline styles.
4. Selected sibling layers enter in sequence as they appear: image, heading,
   then useful details. The mountain retains its own camera movement. No
   scroll pinning, repeated entry on data refresh, nested transform conflict,
   or hidden baseline content is introduced. Focus/input/pointer settle motion.
5. Supporting type is more readable, headings wrap consistently, monetary
   figures use tabular numerals, Thai no longer inherits tight Latin tracking,
   and narrow-screen inputs/empty/loading states share the existing visual rhythm.

## Verification

- 210 behavioral tests pass, including single-dish catalog/history retention,
  dialog interruption/reentry, incomplete image decode, revoked upload preview,
  receipt playback/cancellation, and arrival lifecycle cases.
- Existing economics checks, managed build, built Worker route/asset validation
  and whitespace checks pass. The bundle has 47 assets, with a 9,606,806-byte
  gzip Worker (20,246,498 raw bytes).
- Source review corrected competing dialog controllers, dish-photo arrival
  selection, and focus fallback when a saved dish becomes unavailable or leaves
  the active category filter.
- Browser visual, touch and keyboard QA is unavailable in this environment
  because the supported managed browser skill is absent. No alternate browser
  or preview-server path was used. Rendering and visual feel need user review.

## Review path

Open `/copilot/demo#order`, select a dish photo/name, edit it, then save or close.
Open `/copilot/demo#ai` and press Play sequence. Review each stage, replay it,
then confirm the sample receipt separately. Try Thai and reduced motion, and
visit `/demo` for the retained mountain scene and staged workspace sections.

Full app routes use the same presentation; simulated receipt intelligence
remains confined to the demo. Existing backend, ownership and provider limits
are unchanged. Publish through Sites only; do not push to GitHub or Vercel.

## Merchant sign-in clarification

The full hosted merchant app already exposes Sign in with ChatGPT and checks
owner membership on workspace data. The customer QR menu and simulated demo
remain open without sign-in. A dedicated branded login screen was discussed,
not added in this visual-polish pass.

# Soi Studio design contract

## Purpose

An owner should understand a restaurant's economics, compare a bounded campaign, approve its wording, and record what happened. Evidence and decisions lead the composition.

## Visual direction

A light editorial workspace with an ink navigation rail and emerald/verdigris accents. Body surfaces are near-neutral white; warmth comes from the serif and green material lighting. Display type: Fraunces. Working text: Manrope with IBM Plex Sans Thai for Thai. Tables retain numerical alignment and horizontal overflow on narrow screens.

The overview breaks the repeated dashboard grid with a wide typographic narrative and one offset, translucent green 3D object. Campaign options use distinct editorial rows and a comparison surface. Do not scatter decorative glass panels or repeat identical cards.

The generated atmospheric sky image appears only as a low-opacity backdrop behind the overview's right-side 3D scene. Broad paper-color gradients and an all-edge radial mask blend the photograph into the neutral surface, including toward the text; no hard photo boundary or white text overlay is introduced. Dark type stays readable, and the emerald geometry remains the main accent. The backdrop is quieter on narrow screens and under increased-contrast preferences.

## Motion

One WebGL context in the overview. A small sculptural object responds to fine-pointer input and restrained scroll depth. GSAP owns reveals and view transitions. Lenis smoothing is optional on the overview only; working forms use natural scrolling. Two reveal families maximum. Input never waits for animations. Coarse pointers remove tilt; reduced motion removes smoothing, parallax and continuous rendering. Pause offscreen and when the page is hidden. Renderer failure preserves a static composition.

## State contract

Each view includes loading, empty, error and usable-default states. Native dialogs trap and restore focus. Every field has a label; failures are announced. Buttons use primary, quiet and destructive variants, plus explicit disabled/current states. Full English/Thai navigation and core workflow strings are externalized. One primary heading per view; tab order follows task order.

## References

- Auteur system mode: coherent screens and states, deliberate composition, no marketing-site scroll spectacle.
- Lucxar premium guide: type hierarchy, spacing restraint, selective translucency.
- MustBeSimo cinematic-scroll (now web-design-studio): one renderer, reversible transforms, natural mobile and reduced-motion behavior.
- Shuvam-Banerji-Seal/modern-designmd was unavailable (GitHub 404); the user's supplied description informed depth restraint, without claiming that repository was loaded.

## Verification limit

This managed environment has no control-browser skill. Sites explicitly requires skipping browser QA in that case. Build, syntax, DOM contract and behavioral checks still run; no screenshot/FPS/WCAG conformance claim is made without those checks.

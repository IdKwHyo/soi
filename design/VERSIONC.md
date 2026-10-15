# Version C presentation contract

Version C composes the same shop overview and business controls as A. Its only
overview markup substitution is the photographic window. A and B source files,
source data, exact financial calculations, approvals and full/demo separation
remain outside this presentation change.

The existing generated mountain-window photo supplies the scene. A softly blended
edge and stationary material rim frame independent camera, photograph, haze,
reflection and light layers. Scroll and pointer movement belong to these
decorative layers; report labels and monetary values stay steady and readable.
The motion controller owns their transform and opacity properties.

The image is a native button with a localized English/Thai accessible label and
pressed state. Activating it changes its lighting. The actual photo is decorative,
and the keyboard focus ring sits outside the faded edges so it stays visible.
No new promotional copy or extra section is introduced.

The lighting state now crossfades an identically framed, warm-graded copy of the
same photo, adds a central golden exposure and runs one glass highlight sweep.
It returns after 6.5 seconds, can reverse on another activation, and resets on
Escape or page hiding. The standalone lighting controller and CSS are independent
of the scroll camera. This replaces the original barely visible soft-light tint,
whose strongest hotspot sat beneath the edge mask.

The composition retains A's typography, report density and primary actions.
The photo becomes larger on wide screens and stacks below the controls on narrow
tablets and phones. Its explicit dimensions reserve space before the image loads.
All new CSS is scoped to `.version-c`; pointer transforms are restricted to the
scene and native controls use their existing touch targets.

Reduced motion removes camera transforms. Reduced transparency removes the glass
reflection and haze. Extra contrast preserves a clear focus outline. No looping
animation or automatic page-scroll lock is part of this visual contract.

The camera arc is more pronounced on desktop and softened on narrow screens.
Navigation assembles the existing heading, rail and content in a brief sequence;
each layer settles within 450 ms. Below-fold sections reveal once with shallow
perspective. All content starts visible, and hover, focus or input immediately
settles the relevant region. Form saves and other same-view rerenders do not
replay the construction sequence. Business values remain exact throughout.

Applied guidance: frontend-ui-engineering, its UI workflow and accessibility
checklist, and apple-design's restrained materials, responsive feedback and
reduced-motion guidance. Browser visual checks require the permitted Sites
browser workflow and have not been claimed by source-level review.

# Cinematic sign-in preview — 15 October 2026

`/signin` is a presentation prototype. Its Sign in action opens the existing
`/demo#overview`; its decorative username/password entries are ignored, it creates no authenticated session,
and does not bypass the full app's merchant ownership checks. Demo and QR-menu
links remain directly accessible.

The page uses the retained ivory, forest, rounded glass and editorial type.
One tall mountain portrait carries the composition. Scroll and pointer motion
affect the landscape/glass/background only, keeping entry controls stable.
An intentional Sign in click expands the portrait into the viewport, then the
same landscape dissolves into the existing workspace after its first render.
The short-lived session flag is decoration only, consumed on demo routes.
Reduced motion, forced colors, a failed image, ordinary links without JS,
keyboard navigation and BFCache restoration have fallback paths.

English and Thai are available. The username/password fields accept any text, have no field names to serialize
on native submission, and are never read by the app. They reset when leaving
the page. The small demo note makes this explicit. The preview stores only the existing language
preference and transient arrival timestamp. It sends no credentials or model
requests. Full-app authentication remains Sign in with ChatGPT.

## Artwork

- Method: built-in image generation; ordinary resize/WebP conversion afterward.
- Asset: `/workspace/sites/soi-studio-preview/dist/images/signin-mountains.webp`
- Dimensions: 960 × 1440; 130,380 bytes.
- Original: `/workspace/scratch/494d424e7fef/generated_images/exec-cc74c64d-0f2c-4be0-aa72-4af4dec45611.png`

Final prompt:

> Use case: photorealistic-natural. Asset type: portrait mountain photograph for a minimal luxury website sign-in experience. A magnificent natural mountain landscape, photographed with refined editorial realism: layered dark forest and muted sage-green foothills lead into a majestic distant rocky ridge lightly dusted with snow, with soft ivory dawn sky above and a quiet warm skim of early sunlight on the highest edges. Atmospheric depth and a delicate veil of valley mist; true photographic texture, natural color, serene expansive scale. Tall 2:3 portrait composition, approximately 1024 by 1536. The foreground hills at the bottom create depth while the middle-distance valley gently draws the eye toward the central mountain peak, and the upper quarter remains an uncluttered pale sky. Designed to be softly panned and viewed through a luxury glass portrait frame added separately by the website. Restrained ivory, sage, deep forest, stone and warm silver palette. No buildings, people, animals, roads, text, logos, UI, borders, glass, or window frame. No fantasy shapes, neon colors, oversaturated HDR, illustration, or rendered plastic appearance.

## Verification limits

All 220 behavioral tests pass, including eight sign-in portal lifecycle cases
and two destination-arrival cases. Economics checks, the managed build, built
Worker route/asset validation and whitespace checks pass. The build has 54
assets and a 9,748,592-byte gzip Worker (20,457,172 raw bytes). Browser visual,
touch and keyboard QA is unavailable because the supported managed browser skill
is absent. The asset was visually inspected, but that is not browser rendering
verification. Publish via Sites only; GitHub and Vercel remain unchanged.

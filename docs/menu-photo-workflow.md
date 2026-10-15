# Menu editing, imports and imagery

The embedded merchant menu at `/copilot#order` and `/copilot/demo#order` exposes **Edit menu** and **Import menu** above the dishes. The customer QR menu uses the same saved catalog, in-store prices and availability. Payment stays with the merchant.

## Review flow

1. Edit the existing catalog, choose a menu photo, or import a CSV.
2. Review the editable names, both channel prices, station, preparation time, availability and image choice.
3. Save once. Matching SKUs update, unmatched dishes remain, and historical order prices and recipe links stay intact. New CSV dishes start paused until explicitly enabled.

The photo-to-menu walkthrough is **simulated in the demo**: it produces six named sample dishes, not OCR from the selected photo. The source-photo picker previews the merchant's photo locally. The live app explicitly says photo recognition is not connected and offers working CSV/manual alternatives. No new trained model or live image-generation API is claimed.

The themed image collection was generated for this release. It consists of six 640 × 640 WebP illustrations, with warm ivory stone, sage ceramic and soft window light. Menu frames use a 4:3 center crop; generated imagery is labelled illustrative. Exact generation prompts and asset paths are in `menu-imagery.json`. Merchants may instead upload real dish photos or choose no photo.

## Data and image handling

- CSV: exact eight-column schema, UTF-8, 50 KB, at most 60 menu items after merging; prices parsed as integer satang. Import does not change the saved catalog before review and save.
- Photos: JPEG/PNG/WebP, original up to 8 MiB; client checks dimensions, scales to 640 pixels and re-encodes to strip metadata. Live server independently validates raster magic, byte count and dimensions. No SVG/remote image URL is accepted.
- Demo: bounded separate browser photo store, no model/backend requests. Real dish photo uploads, edits and CSV imports persist in that browser. Restart clears demo records and photos.
- Live: same-origin authenticated upload, business-scoped R2 keys, bounded manifest, content hash deduplication and revision-guarded reservation. Owner preview can show pending or paused photos; public image serving requires an available menu reference. No owner details are exposed.
- Save concurrency: the editor pins the editable catalog fingerprint. Uploads or queue updates may advance the workspace revision, but a changed catalog forces reopening the latest editor. A fresh load plus server revision guard protects the final save.
- Dismissed asynchronous imports do not reopen the dialog. Draft photo previews are released when it closes.

## Verification limits

Behavioral tests cover imports, exact money, photo ownership/public projection, demo isolation, bounded uploads and stale catalog detection. Build validation requests the generated CSS and six food assets from the packaged Worker. Supported browser tooling is unavailable in this managed environment, so actual visual, touch and keyboard browser QA remains pending.

Publish through Sites only. Keep public page access and all existing A/B/C and full/demo routes. Do not push GitHub or deploy Vercel without a new instruction.

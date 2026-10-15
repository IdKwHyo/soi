# Soi Studio: Vercel export

This repository preserves the current Soi Studio source, including its sign-in scene, simulated workflows, connected app, API implementation, database migrations, images, fonts and English/Thai legal pages. The Vercel adapter adds hosting configuration only. It does not redesign or rewrite application files.

## Hosting behavior

| Entry | Vercel behavior |
| --- | --- |
| `/signin` | Local cinematic demo sign-in, including username/password fields and the original mountain transition |
| `/demo`, `/versionc/demo` | Complete local simulated studio |
| `/copilot/demo` | Local merchant demo; `#order` opens the menu and `#ai` opens the AI/receipt demonstration |
| `/menu/demo` | Local customer QR menu demo; query parameters identify the demo shop/table |
| `/privacy`, `/terms`, `/th/privacy`, `/th/terms` | Original localized static policy pages |
| `/`, `/versionc`, `/copilot`, `/menu`, `/signin-with-chatgpt` | Temporary redirect to the same path on the existing connected Sites host |
| Direct `/index.html`, `/versionc/index.html`, `/copilot/index.html` | Redirect to the corresponding connected Sites page |
| Retired A/B routes | Full routes redirect to the connected app; demo routes redirect to local `/demo` |
| `/api/*`, unknown paths | No API proxy or app fallback; Vercel returns its normal not-found response |

**Connected mode continues at `https://soi-studio-preview.karndanai537.chatgpt.site`. Its URL is visible in the address bar after selecting Full app.** The existing app depends on Sites-managed authentication, trusted identity headers, D1 storage and R2 bindings. These are not portable credentials and cannot be safely recreated by adding an external rewrite. No identity headers are forged, no cookies are relayed, and no public static copy impersonates a working connected backend.

Redirects contain no query or fragment override. Native Vercel redirects retain query parameters, while browsers retain the original fragment when the redirect target supplies none. This keeps table links and section anchors meaningful. Trailing slashes are normalized by Vercel. The exported static build has no server functions or universal SPA fallback.

Demo data, language and privacy preferences are browser-origin storage. Existing edits saved under the Sites origin do not automatically appear under the new Vercel origin. The same demo initializes with its original sample data there. The simulated sign-in remains simulated; typed username/password values are neither stored nor submitted.

## Build

Vercel uses these checked-in settings:

```text
Framework preset: Other (framework: null)
Install command: npm ci
Build command: node scripts/build-vercel.mjs
Output directory: vercel-dist
```

The adapter runs the unchanged `scripts/build.mjs` and `scripts/validate.mjs`, copies `build/client` into `vercel-dist`, then checks every output path, byte length and SHA-256 digest against the validated browser build. Source files, Worker code, SQL migrations, secrets and platform metadata are not served as public assets. The original security response headers remain applied. Font/image/animation/locale files are copied without transformation.

The original build obtains its pinned Thai and English OCR model files from jsDelivr when its validated build cache is absent. Build network access is therefore required. Checksums are verified by the unchanged OCR preparation module. `npm ci` uses the committed lockfile.

For verification, run the repository tests and economics check, followed by the Vercel build. `tests/vercel-routes.test.mjs` checks that local simulation routes stay separate from connected-mode handoffs, static entry URLs cannot accidentally launch full mode on Vercel, API paths have no app fallback, and the export preserves binary/text bytes. This configuration check is not a substitute for verifying actual deployed redirect responses, query preservation, static routes and browser rendering.

## Preservation and remaining operator decisions

The existing Sites app and its data remain authoritative for connected mode. The GitHub repository contains the full implementation, but this deployment does **not** claim a migrated Vercel database, object store, authentication provider or live Gemini training service. A future independent backend migration needs those resources configured and tested together.

The user requested an unchanged copy. Existing legal text is therefore retained verbatim. Vercel is an additional hosting recipient and must be reflected in a later approved policy update; existing draft/operator-contact/retention review requirements still apply. This export makes no new legal-compliance claim.

References used for this adapter:

- [Vercel static project configuration](https://vercel.com/docs/project-configuration/vercel-json)
- [Vercel configuration redirects](https://vercel.com/docs/routing/redirects/configuration-redirects)
- [Vercel routing middleware](https://vercel.com/docs/routing-middleware)

# Soi Studio architecture

Implementation checkpoint: 12 October 2026. Sites review build; GitHub and Vercel remain unchanged.

## Product and provider modes

The eight original English/Thai views plus a guided Business workflow: Overview, Advisor, Data, Analysis, Campaign, Memory, Results and Settings. Both visual editions use the same domain modules, provider modes and response shapes.

| Route | Chat, retrieval and evaluation | Receipt reading | Persistence |
| --- | --- | --- | --- |
| /, /versiona, /versionb | Real configured Gemini + semantic retrieval + evidence judge. Missing configuration is a setup/error state, never a simulated reply. | Actual browser-local Thai/English OCR; explicit manual fallback. | Authenticated D1 and private R2. |
| /demo, /versiona/demo, /versionb/demo | Labelled intent-specific simulated replies/retrieval/evaluation using current demo records. No workspace API or model call. | Editable labelled sample extraction, no OCR-model download; manual entry also available. | Separate browser-local key soi-studio-v2-demo. |

The demo still requires the hosted frontend assets; it is backend-independent, not an offline installation. Main data-entry/calculation views retain an explicitly labelled local sample if private storage is unavailable, but the live Advisor cannot generate a pretend reply.

## Visual editions and routing

The Worker maps six explicit page routes to two HTML/bundle entries. Unknown nested routes stay 404; trailing slashes redirect to their canonical route with queries intact. Main APIs keep the same `/api/*` namespace and visitor identity checks. All HTML is private/no-store; shared assets keep original bytes and normal hosting compression.

`dist/routes.mjs` owns edition/mode context and view-preserving links. `dist/versiona` retains the previous renderer/style/motion; `dist/versionb` owns the new cinematic overview, translated narrative, working-screen skin and dimensional motion. Version A visual source hashes are recorded in `design/versiona-baseline.json`; the unchanged stylesheet/motion are checked against them. `scripts/build.mjs` builds two entries with shared hashed chunks, fonts, OCR assets and images, keeping the packaged Worker below its compressed limit.

Both demo editions share `soi-studio-v2-demo`; main local sample uses `soi-studio-v2-local`. No new business table, provider layer, model training or backend feature was added for the visual comparison.

## Modules

| Module | Responsibility |
| --- | --- |
| dist/core.mjs | Strict aggregate CSV grammar and exact satang financial calculations. |
| dist/advisor.mjs | Conservative receipt fields, exact validation, owner confirmation, evidence corpus and simulated replies. |
| dist/data.mjs | Backward-compatible schema-2 workspace, immutable datasets/campaigns and sourced memory. |
| dist/client.mjs | Serial client mutations, provider isolation, cancellation, archive-before-confirmation and uncertain-response recovery. |
| dist/ocr.mjs | Same-origin Tesseract 7 Worker protocol, validation, progress, cancellation and disposal. |
| worker/backend.mjs | Visitor identity, owner-scoped actions, input/body/Origin bounds and revision checks. |
| worker/assistant.mjs | AI SDK Gemini chat, 768D embedding/cosine retrieval, source validation and evidence evaluator. |
| worker/model.mjs | Candidate refinement, provider privacy gate, allowlisted assumptions and exact recalculation. |
| worker/storage.mjs | D1 transaction/CAS, R2 private archives, bounded cache eviction and orphan cleanup. |
| dist/versiona/motion.mjs; dist/versionb/motion.mjs | Separate visual choreography: native Motion springs, overview GSAP/Lenis and one Three.js scene per active edition. |

The current deployment adapters are D1 SQL and R2 objects. A future PostgreSQL/Vercel release needs storage/auth adapters and provisioning, including transaction/ownership verification. This preview is not deployed there.

## Merchant workflow extension

`dist/merchant-flow.mjs` holds validated channel sources, goals, optional period costs/cash inputs, scenario assumptions and up to 50 immutable outcome snapshots in `state.merchantFlow`. Old schema2 workspaces gain empty channel references; an unassigned source is never silently attributed to Grab or storefront. Separate reports must have matching dates before combined totals are shown.

The shared `merchant-flow-ui.mjs` presents eight EN/TH steps. `overview.mjs` presents concise shop/report content and a photographic window. Existing standalone tools and A/B comparison routes are preserved.

Actions `merchant-flow` and `flow-outcome` use the existing private owner membership, body bounds and optimistic revisions. Main outcome sources are owner-entered; demo sources are explicitly demo. Stable confirmation IDs make identical retries no-ops and reject changed contents. The local-only `merchant-flow-sample` action creates/reuses two distinct synthetic reports and is rejected before any live request on full routes.

The extension calls existing exact calculations and adds an adapter for price-changing scenarios: the original menu price is the baseline, while the offer uses scenario price/discount. Existing-order contribution changes can be gains or losses; the original `core.mjs` equations and legacy campaign approval gates remain unchanged. Actual estimates use pinned original baseline and offer contributions.

Cash buffer is entered cash plus receivables minus upcoming payments, not derived from contribution. CAC needs observed/assumed new unique customer counts; missing/zero customer denominators stay unavailable. Customer shares are descriptive; observed payback days are separately owner-reported. No retention, lifetime value, causal lift or generated payback time is inferred. Outcome save dates and source report periods do not establish an observed campaign date range.

Workflow context enters the Advisor evidence corpus and both cloud/local campaign fingerprints. Default-unassigned demo behavior remains backwards compatible. Merchant context overrides also enter the provider-eligibility gate. Legacy campaign generation still derives its financial candidate menu from the active dataset; the guided multi-channel what-if tool is separate and explicitly scoped.

## Chat and RAG

An owner question is embedded in real time. The corpus consists of current exact metrics, business profile, confirmed memories, confirmed receipt fields and a small explicitly project-authored commercial playbook. Long evidence is chunked with stable parent/excerpt references; all supported receipt lines remain available. It is not an externally validated expert corpus.

Document and query embeddings use the configured Gemini embedding model at 768 dimensions. Cosine similarity selects four documents. Source IDs and action types from generated output must resolve to the supplied evidence and safe in-app actions. Generated external links and credential echoes are rejected. Source-structure checks do not prove that every generated statement is factual; the interface shows their precise scope.

The bounded recent conversation is reference context. Receipt/report/memory strings are untrusted reference data, never instructions. Gemini has no database authority, arbitrary tools or automatic campaign publishing.

## Candidate comparison

Main comparison with evidenceEvaluation:true runs:
1. Exact code metrics and two initial strategy shapes.
2. Semantic retrieval for the campaign brief.
3. Gemini refinement supplied with those four evidence documents.
4. A separate Gemini evidence judge using the same documents.
5. Authoritative margin, budget, capacity, break-even and dataset checks.
6. Owner review and approval of the pinned snapshot.

The judge's groundedness is a subjective rubric score, not a calibrated probability or predicted campaign effectiveness. Unsupported claims/evidence failures block approval. The legacy keyword memory utility remains available independently; it is not labelled semantic retrieval.

This is model inference plus our external context/evaluation logic. No custom trained weights have been trained or deployed. A separately trained scorer/rewriter still needs expert-rated commercial examples, held-out evaluation and deployment. Comparing two drafts is not a causal customer A/B experiment.

## Receipt intake

Photo -> actual OCR or labelled demo fixture -> conservative structured fields -> numeric/provenance review -> explicit owner confirmation -> immutable record.

Unknown dates, quantities and unit prices remain null. OCR never infers quantity from an amount alone. Contradictory item/receipt arithmetic and unsupported currencies require correction. The owner can start a blank manual receipt before or after OCR failure; its origin explicitly says no OCR occurred.

Real attached photos are JPEG/PNG/WebP, bounded to 8 MiB, type/magic validated, privately archived before confirmation and SHA-256 identified. An existing file can also support manually entered fields. Text-only manual receipts have no fabricated photo archive. Stable confirmation IDs and unique confirmed upload references prevent duplicate records after a lost response.

Receipt confirmation does not automatically alter menu sales, portion costs or financial datasets. A purchase invoice is purchase evidence; recipe usage/yield is still needed for cost per serving.

## API and ownership

Sites supplies oai-authenticated-user-id. The server derives business membership; client business IDs never grant access.

| Route | Contract |
| --- | --- |
| GET /api/health | Safe capability flags only. |
| GET /api/workspace | Authenticated current owner workspace. |
| POST /api/workspace | action/payload/expectedRevision; includes chat, chat-clear and receipt alongside existing actions. |
| POST /api/receipt-source | Same-origin owner multipart file + expectedRevision; private archive and revision-guarded metadata. |
| GET /api/receipt-source/:id | Owner-only original photo download. |
| GET /api/archive/:importId | Owner-only original CSV gzip download. |
| GET /api/memory?q=... | Clearly labelled top-four keyword memory utility. |

JSON writes are stream-bounded to 1,200,000 bytes; multipart photo handling has its separate 8 MiB file bound. CAS loser cleanup deletes only the request's unreferenced object. Ambiguous commits retain potentially committed objects rather than deleting evidence.

Forward migrations 0000_initial and 0001_advisor_records are packaged and applied before publication. The second preserves existing records/index/ownership FK while allowing receipt kinds. Request handlers never create tables. Applied migration0000 is unchanged.

## Compression, caching and bounds

Original CSV UTF-8 is losslessly gzip archived with hash/size limits. Photos retain their original image bytes. Context selection is separate from archival compression.

Application text/assets are served as original bytes; hosting negotiates transport compression. No pre-gzipped HTML is declared as uncompressed text. app.js/style.css references use content-derived revision queries.

Embeddings, replies and evaluations are cached by business, content, language, model and pipeline versions. Vector TTL is seven days; generated replies/evaluations use one hour. Cache capacity is 700 rows/8 MB; eviction is owner-scoped and guarded by successful workspace CAS. Nonessential oversized cache writes are skipped, not allowed to block a valid merchant save.

Active workspace JSON is capped at 1.5 MB. Current history bounds include 80 chat messages, 50 confirmed receipts, 50 photo metadata records, 30 receipt lines and 12,000-character receipt text. Existing dataset/import/memory/campaign bounds and retained immutable-record/audit/source-byte bounds continue across resets. Full retention/deletion management and archive reconciliation remain production extensions.

## Configuration and verification

Server-only GEMINI_API_KEY and ALLOW_MERCHANT_AI=true enable merchant-context chat/retrieval/evaluation after suitable provider/data handling is selected. GEMINI_MODEL and GEMINI_EMBEDDING_MODEL are configurable. No key is supplied in this review. The app exposes no credential-entry field or browser secret.

83 tests passed: domain, actual SQLite ownership/migrations/CAS, SDK mocked Google HTTP, provider/source failure paths, cache eviction, private images, client demo isolation/ambiguous saves, and OCR Worker protocol/lifecycle. Exact financial checks and artifact/static-asset validation also passed. The self-hosted OCR adapter was exercised against the real Node engine on the clean Thai fixture and read223.00 correctly.

No live Gemini invocation or representative merchant OCR benchmark has occurred. Browser visual/interaction QA remains unavailable under the supported Sites workflow. No measured frame-rate, WCAG conformance, causal lift or production load-capacity claim.

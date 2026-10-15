# Soi Studio

A commercial workspace for independent restaurants: exact menu economics, Advisor chat, receipts, sourced memory, campaign comparison and results.

This is the Sites review build. GitHub and the existing Vercel deployment are unchanged.

## Compare the visual editions

| Edition | Full app | Simulated demo |
| --- | --- | --- |
| Version A — retained editorial workspace | /versiona | /versiona/demo |
| Version B — cinematic merchant journey | /versionb | /versionb/demo |

Original `/` and `/demo` remain Version A aliases. Every route supports the same eight views via hashes (for example `/versionb/demo#advisor`). The header comparison menu retains the current view and lets the owner choose an edition and mode. Both editions use one owner-scoped live workspace; both demos use the same isolated browser-local demo key, making comparison possible on the same records. Switching visual editions does not copy demo records into the live workspace.

Version A is the preferred minimal presentation. Its base stylesheet and Motion implementation are retained; a separate photographic presentation sheet replaces the abstract sculpture with an image-generated architectural window facing misty mountains. Both editions now use concise shop/report copy and the same eight-step merchant workflow, instead of promotional slogans. Version B remains an alternate layout. Neither overview creates a WebGL canvas.

## Guided merchant flow

Open `#workflow` from any full/demo edition:

1. Shop goal and period costs.
2. Storefront, Grab or combined calculation scope.
3. Assign separate immutable sales reports; use existing CSV, manual entry and receipt tools. Demo users can explicitly load two labelled synthetic channel reports.
4. Compare storefront prices with Grab receipts after fees. Reported item fees are preserved unless the owner supplies an effective rate; the reference diagram’s 32.1% is an illustration, not an official universal rate.
5. Revenue, variable costs, contribution, explicitly entered overhead/marketing and a cash buffer from entered cash/receivables/payments. Incomplete totals remain incomplete.
6. Optional source-backed Advisor review. The legacy campaign A/B tool remains available.
7. Price/discount/advertising/customer scenarios. Original source prices remain the baseline; existing-order gains/losses and break-even are exact-satang calculations.
8. Owner-reported outcomes, CAC, customer shares and optional observed payback days; reuse pinned source/scope/fee context for a new scenario. Records are immutable and retries with the same confirmation ID do not duplicate them.

The original data, OCR, chat, memory, campaign editing/approval, results and export tools remain available. Workflow settings extend schema2 workspace JSON without a new SQL migration; they do not change `core.mjs`. Current results carry a save timestamp and original report period, not an entered observation-period range. Customer shares are descriptive counts rather than cohort retention or lifetime-value forecasts.

## Workflows

Owner setup -> strict CSV/manual figures -> exact analysis -> evidence-backed campaign comparison -> copy/capacity review -> pinned approval -> results.

Chat can use current evidence and propose reviewable app actions. Receipt photo or manual entry -> editable fields -> numeric checks -> owner confirmation. A receipt does not automatically change sales or ingredient cost per serving. Real photos are private and saved before confirmation. Retry-safe identifiers avoid duplicate confirmed receipts after an ambiguous response.

RAG uses real query/document embeddings and cosine top-four retrieval when configured. The domain corpus currently contains workspace records and explicitly project-authored guidance, not a validated expert training dataset. The A/B judge compares draft evidence and constraints; it does not prove customer lift. A custom trained scorer remains a future separately trained adapter.

## Checks and build

```sh
npm ci
npm test
npm run check
npm run build
npm run validate
```

The build bundles the browser and a self-contained Worker, prepares pinned Thai/English recognition models plus WASM assets, and packages forward D1 migrations. First uncached build requires model-download access. OCR runs in the merchant browser; runtime dependencies are served from the app.

The Worker gzip budget is checked at 10 MiB. App assets keep original bytes and hosting owns HTTP compression. CSV source gzip archives are separate.

## Server configuration

Configure server-only Sites secrets:

- GEMINI_API_KEY
- ALLOW_MERCHANT_AI=true when the provider arrangement permits the intended merchant context
- Optional GEMINI_MODEL (default gemini-3.5-flash-lite)
- Optional GEMINI_EMBEDDING_MODEL (default gemini-embedding-2)

No key is included or configured. Main chat does not silently substitute simulated replies. /demo remains usable without one. AI SDK7.0.137/Google4.0.93 calls were verified against installed docs/source and mocked Google HTTP; no live Gemini call occurred.

## Architecture and limits

See docs/architecture.md and docs/advisor-contract.md. Sites uses D1/R2 with owner membership checks and optimistic revisions. A future Vercel/PostgreSQL release requires adapters/provisioning; this is not already deployed there.

119 behavioral tests passed, plus exact financial checks and artifact validation. Real Node OCR read the clean Thai fixture; browser end-to-end OCR and visual/interaction QA remain unverified. Representative merchant photo accuracy, trained scoring quality, causal lift and production load are not claimed.

## Licenses

Dependency versions are locked. Build retains generated bundle notices, fonts and OCR engine/core licenses. OCR model download versions/hashes are pinned. Review model terms before changing weights or provider use.

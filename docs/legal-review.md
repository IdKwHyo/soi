# Preview privacy and terms review

Reviewed 15 October 2026. Scope: the retained Soi Studio full app, simulated demo, QR menu and simulated sign-in. This change adds a small normal-flow footer, English/Thai notices and on-demand privacy choices. It does not install a compliance product, legal chatbot, analytics SDK or advertisement tracker.

## Evidence and current controls

The factual source inventory is [legal-data-audit.md](legal-data-audit.md). Canonical translated copy lives in `scripts/legal-content.mjs`; the build renders it into four static pages (`/privacy`, `/terms`, `/th/privacy`, `/th/terms`). The pages remain readable without JavaScript. App language changes update the shared footer. Privacy choices has a static policy fallback.

The application presently contains no optional analytics or marketing service. Therefore no first-visit interruption or meaningless Accept button is shown. The bottom links are subdued, but remain readable and keyboard accessible. The preferences panel states what is actually enabled and lets visitors record that optional services must remain off.

Optional-service integration must use the consent gate and must disclose the actual provider, purpose and data before enabling that integration. It is a registration/loading control, not an automatic interceptor for arbitrary future `fetch`, script tags or hosting-injected code. Browsing, dismissing the panel and simulated sign-in do not grant consent. Essential workspace storage and user-requested API/OCR requests are not controlled by optional tracking consent.

## Referenced project

[FuzulsFriend/compliance-auditor](https://github.com/FuzulsFriend/compliance-auditor) was inspected through the GitHub connector and public README. It describes code-aware document drafting and review, and explicitly describes its output as first drafts requiring qualified legal review. Its README does not substantiate a universal automatic script blocker or a guarantee against litigation. Its core useful approach here is tracing policy statements to real source behavior; no package was installed or executed.

The supplied [MCP discussion](https://github.com/chatmcp/mcpso/discussions/3088) could not be retrieved (tool returned an internal error on two attempts). No feature claims depend on its contents.

## Primary-source checks

- [EDPB Cookie Banner Taskforce report, January 2023](https://www.edpb.europa.eu/system/files/2023-01/edpb_20230118_report_cookie_banner_taskforce_en.pdf): consent-requiring storage must not precede affirmative consent; preselected choices and interfaces that push acceptance are problematic. In this app there is no optional tracker to load, so a hidden or obstructive cookie wall would add no protection. If optional services are added, provide clear accept/reject choices at that point and straightforward withdrawal.
- [European Commission: information for individuals](https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en): notices require the controller's identity, purposes, legal bases, retention, recipients/transfers and rights information. Code inspection alone cannot supply the missing operator or contracts. The preview notice explicitly marks those gaps instead of inventing them.
- [Thailand PDPA, government-hosted English translation](https://www.dol.go.th/media/813280155698073600/2026/01/5TMF1n9au27Gqoxmf4e8JXZL.pdf): sections 19 and 23 address clear consent/withdrawal and notice information including identity/contact, purposes, retention, recipients and rights. The document is an unofficial translation of the statute. Thai localisation does not establish compliance with Thai law.
- [European Commission AI Act Article 50 text](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50): transparency information for relevant AI interactions must be clear and available by first interaction; a footer alone is not a substitute. The existing interface distinguishes simulated and live AI. Formal applicability, system-role/risk assessment and any machine-readable output-marking obligations need a separate production review.

## Readiness assessment

| Area | Current position | Remaining work before operational personal-data use |
| --- | --- | --- |
| Privacy notice | EN/Thai code-matched preview | Confirm operator legal name, address/contact, roles, purposes and legal bases |
| Consent | Essential-only UI; optional services denied by default | Re-audit all new providers, purpose disclosures and hosted-network behavior |
| Cloud records | Private workspace checks; source files and history retained | Approved retention schedule and complete erasure/request workflow |
| Providers | Sites/Cloudflare; Google when enabled | Confirm runtime configuration, contracts, regions, transfers, logs and provider AI data-use terms |
| AI transparency | Existing demo/live labels; human review of evidence | Jurisdiction/role assessment and applicable AI Act obligations |
| Terms | Evaluation scope, no checkout or billing, mandatory rights preserved | Identified contracting party and commercial terms before subscription launch |

These pages are draft preview documents, not legal advice or a GDPR/PDPA/EU AI Act certification. Qualified counsel and operational evidence are needed before relying on them for a commercial launch. Do not advertise a “cannot be sued” feature.

## Maintenance rule

When code adds or changes data collection, storage, AI providers, analytics, public visibility, retention, deletion or payment/authentication behavior, update the data-flow inventory and both language versions in the same change. Recheck the consent gate for every optional provider. Do not convert unknowns into guarantees without verified evidence.

Browser rendering, keyboard/touch interaction and deployed network inspection remain unverified when the managed browser skill is unavailable. Automated tests cover the consent gate and built route/asset behavior, not legal compliance.

## Verification for this release

230 behavioral tests pass, including 10 consent-gate cases covering no-consent blocking, explicit consent, purpose isolation, revocation, delayed cleanup, cross-tab updates, expiry and storage failure. Existing economics checks pass. The managed build and built Worker verification cover full/demo shells, four static bilingual legal routes, headers/methods, assets and footer placement. Source integration review corrected a legal-page/dialog typography collision. The final bundle contains 60 assets, below the 10 MiB compressed Worker limit. No browser visual/network QA was available.

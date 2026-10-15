# Advisor implementation contract

Shared UI; `/demo` explicitly uses simulations and isolated local state; `/` uses real configured adapters and never silently substitutes simulated chat or OCR results.

## Shared domain (dist/advisor.mjs)

- normalizeAssistantState(state): add absent messages, receipts and receiptUploads arrays to old schema-2 workspaces.
- parseReceipt(text, {name, engine, simulation=false}): return editable receipt draft.
- sampleReceiptDraft({name}): return explicitly simulated THB223 receipt fixture.
- validateReceiptDraft(receipt): return normalized draft or throw; preserve missing fields; enforce exact money/line arithmetic and THB-only supported contract.
- confirmReceipt(state, {receipt, reviewed:true}): preserve stable confirmation ID, reject duplicate ID/upload and append confirmed immutable receipt; owner corrections explicit; return record. No automatic mutation of menu-sales dataset.
- recordExchange(state, {question, response, language, mode}): append bounded user/assistant message pair; return assistant response/message.
- buildEvidence(state): return document corpus from exact metrics, current confirmed memories, confirmed receipts and clearly attributed project-authored commercial playbook.
- simulateReply(state, {text, language}): labelled scenario response {answer,sources,assumptions,actions,retrieval,evaluation?} using current demo state.
- Clear-chat is a workspace action clearing current messages, without deleting unrelated receipts/facts.

Documents/sources use {id,title,text,sourceType,source,updatedAt,reference?}. Replies use {answer,sources,assumptions,actions,retrieval,evaluation?}; safe action types are compare, data and receipt-review. No generated URLs or automatic writes.

Receipt fields: {id?,name,kind:'sale'|'purchase'|'other',merchant,date,currency:'THB',items:[{name,quantity:number|null,unitPrice:number|null,lineTotal:number|null}],total:number|null,text,source:{mode:'ocr'|'manual'|'simulated',engine},uploadId?,warnings:[]}. Saved records add status confirmed and timestamps. Quantities are not guessed from amount alone; unknown values remain null. No confirmation with unresolved arithmetic contradictions. Receipt-only data does not establish ingredient cost per serving.

Workspace keeps messages <=80, receipts<=50, receiptUploads<=50, <=30 lines/receipt, text<=12000 and answer<=8000. Owner-entered manual receipts are explicitly labelled and do not claim OCR. Receipts/memory source content is untrusted model reference data.

## Client (root-owned dist/client.mjs)

- askAdvisor({text,language}): Promise existing {state,capabilities,operation:{response}}. Demo calls simulateReply+recordExchange locally; main calls workspace action chat with revision guard. Missing key/backend is actionable error, never fake reply.
- readReceipt(file,{onProgress,signal}): Promise draft. Demo sampleReceiptDraft without OCR/model downloads, explicitly labels simulated values even for arbitrary supplied image. Main calls real self-hosted OCR then parseReceipt.
- saveReceipt(receipt,file?): archive actual source photo first in main if supplied, then workspace action receipt {receipt,reviewed:true}; update returned revision between calls. Demo confirms locally with no API.
- clearChat(): workspace action chat-clear.

## Backend

Existing /api/workspace POST actions chat, receipt, chat-clear. Chat/retrieval/evaluation adapters server-only. Real semantic retrieval uses query/document embeddings and cosine top3-5, cached per business+document content+embedding model. Model calls require configured key and existing merchant-context gate. Candidate A/B gets evidence-based evaluator plus authoritative financial checks; no trained-layer claim.

POST /api/receipt-source accepts owner-authenticated same-origin multipart file + expectedRevision, bounded8MB JPEG/PNG/WebP, magic validated. Save metadata in scoped receiptUploads, R2 originals private. Return state/capabilities and operation.source upload id. GET /api/receipt-source/:id downloads only owner-scoped original. Confirm action validates uploadId against current business record. CAS failure cleans only own unreferenced upload.

Receipt source archive is optional only for manually entered/reviewed text. Actual attached files should be retained privately when confirmed.

## Real OCR (dist/ocr.mjs)

ocr(file,onProgress,{signal}?) -> {text,blocks,engine,confidence}. closeOcr() disposes. Self-host tested worker/core/WASM/tha+eng assets via build to avoid third-party model/CDN failures; preserve native browser-local processing. Do not start browser QA/server without Sites-permitted control-browser. Node engine/HTTP/asset checks are allowed.

## Ownership

Domain agent: dist/advisor.mjs, dist/data.mjs, tests/advisor-domain.test.mjs. Backend agent: worker/assistant.mjs, worker/model.mjs, worker/backend.mjs, worker/storage.mjs, tests/advisor-backend.test.mjs. UI agent: dist/app.mjs, dist/style.css, dist/i18n.mjs. OCR agent: dist/ocr.mjs, scripts/build.mjs, OCR asset-download helper if needed. Root: client integration, dependency metadata/install, validation, docs, publication/progress. Agents do not build concurrently or publish.

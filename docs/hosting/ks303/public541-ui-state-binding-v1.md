# KS303: independent public PAN541 / existing KS UIState binding

This is an independently executable, thin consumer increment. It is not a completed KS303 shared browser/result journey or a PAN549 analysis implementation. Original five KUI and eight UIDOD criteria remain non-waived.

## Reused source and executable core

PANSPHAIRA public release `2026_10_07_v1` / 405200494 is `SOURCE_EVIDENCE_ONLY`, with no uploaded runnable assets. Its immutable source is commit `6153161c3d9510bab305a28a20c7099dbba6a7ff`, tree `1a63a35acd9c3fee0b7a9cba1a335cdd177adaa6`. The ordinary generated TAR SHA256 is `e1e5e61d40efb97d7ba5458a718937302f82c2d7c37a9372b579ffd822a1624a`; GitHub API legacy TAR is a different container format, not that digest. All 2735 exported source blobs were compared with the exact public Git tree before consuming the four core files.

`contracts/dependencies/pan541-browser-shell-v1/binding.json` pins the original descriptor validator, registry, context owner and deep-link source bytes and their unchanged compiled runtimes. The four TypeScript originals and upstream LICENSE/NOTICE are retained. Runtime files were produced solely by TypeScript 6.0.3 with ES2022/ES2022/Bundler, strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, skipLibCheck and noEmitOnError. No runtime logic was rewritten; no npm installation or global dependency change was needed. The generated code is not a substituted PAN549 implementation.

The existing KS contract/consumer is `services/bi-control/src/assistant-foundation/ui-state-adapter.mjs`, byte-identical to KS base `0a0488d6a5f48ce86702d0daacf8dc450377e4b5` / tree `95dc35323117f98f485a4da018b5b6f9e280ae59`. Neither it nor the standalone protected #293/#294 routes or #167/#236 owner scopes are altered. This Node-side adapter reference is not a claim that a real browser frontend or protected backend is already bound.

## Actual consumer boundary

`createPan541UIStateConsumerV1` produces exactly one closed PAN plugin descriptor and two trusted owned factories: view and panel, plus a registered logical route. Supply the actual shared context owner and a current trusted owner authorization callback. Supply owned view/panel render functions, never caller URLs, iframe content, remote imports, DOM-control metadata or persistent mutation flags. Register the returned descriptor/factory map with the actual PAN registry; it grants no rights.

The callback is captured at construction and checked again for each view, panel, apply and undo use. Its boolean qualifies only this reversible client session. It is not a portable grant, a server-authentication implementation, or authority to mutate a persistent asset. Production authority must still come from the actual protected backend/consumer at use.

The original adapter supplies action allowlisting, resource validation, idempotency, version checks and undo. Requests are bounded data-only snapshots, captured before asynchronous authorization and bound to an explicit matching dashboard precondition. A context switch, logout/owner disposal or close retires the old consumer and pending state actions. The shell owner constructs a fresh consumer for the next binding. The adapter does not close the shared registry, other plugins, or global context owner.

Logical session deep links use the actual PAN parser/builder. The object's deep-link `revision` here means the existing UIState version, not shell-context revision, source-data revision or persistent approval revision. The binding exposes these distinctions explicitly: `sessionStateVersion`, context `revision`, and `dataResultRevision: null`. The latter is deliberately absent until the actual analysis/result contract is supplied. Link parsing grants no rights; opening/rendering still rechecks the current trusted callback.

## Executed checks and nonclaims

`node --test tests/ks303-pan541-ui-state-binding.test.mjs` exercises the actual released compiled PAN descriptor/context/registry/deep-link functions and existing KS adapter. Positive view/panel/session/undo, scope/state/version, late authorization, actual registry abort, revoked/expired denial, options/accessor/URL, source identity and isolated renderer fault are covered. The authorizer and target are explicitly local test fixtures; this is in-process consumer/core integration, not a browser/request/backend numeric-result PASS.

The test rides the existing source-map canonical parent exactly once, preserving the frozen package command and all historical evidence. The declaration `pan541-ui-state-consumer-v1.d.mts` uses producer types; the runtime uses producer validation and existing KS action validation.

Missing whole-composition capability: the actual immutable PAN549 bounded result projection/renderer entrypoint and its identity-bearing contract, with a permitted local synthetic backend result and origin/session/scope binding. Required fields are source/result identities and revisions, cutoff, grain, units, UNKNOWN/UNAVAILABLE/PARTIAL/suppression semantics and proposal/effect separation as actually defined by that producer. No invented fields, new metric engine, artificial dashboard, source/production rights, human promotion gate or reciprocal CLOSED requirement is introduced. Public541 is available and never a private-handoff wait.

Whole KS303 requires the actual shared positive/negative browser/backend/numeric journey, measured and visually inspected desktop/390/zoom/focus states, required full CI, SHA-bound merge, new correctly classified release, exact anonymous downloaded-product readback and original closure afterward. This local increment alone does not satisfy those gates.

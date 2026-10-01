# KS250 — truthful synthetic preparation v2

This corrects the released preparation contract. It is not a real pilot, source connection, reader observation or measured reuse finding. #250 and its parent #245 remain partially delivered; AC02–AC04 still require their exact external inputs.

## Active entry and version boundary

`node scripts/run-read-only-metric-pilot.mjs` now uses `read-only-metric-pilot-protocol-v2.mjs` and produces package schema `kaleidosphere.business-bi/read-only-metric-pilot-package/v2`.

Existing credential-free v1 protocol/context/explanation fixtures remain accepted as explicitly synthetic inputs, byte-preserved. Input declarations are not observations or authorization. The old module and the exact old CLI (`scripts/run-read-only-metric-pilot-v1.mjs`) remain frozen for historical replay, not active qualification. Do not use the old v1 qualifier to interpret a HUMAN_READING label as observed evidence. A v1 package is not an accepted v2 package; rebuild it from independently retained inputs rather than resealing it.

## Corrected contracts

- T1: accepted inputs are SYNTHETIC_NON_CUSTOMER_BYTES. Every accepted rehearsal has realPilotExecuted=false, qualifiedContextCount=0 and no humanComprehensionEvidence, even if the declaration is HUMAN_READING or declares non-null timing. The declared text/class and timing remain input data; they are never genuine reader observations. No new real-source execution path is authorized or implemented.
- T2: first and second contexts both need separate permission records before even contract-level reuse. Missing or revoked permission for either remains BLOCKED_EXTERNAL with the exact FIRST_CONTEXT_NOT_PERMITTED or SECOND_CONTEXT_NOT_PERMITTED gate. A grant for one context never admits the other.
- T3: no mapping or special-case observation is collected by this synthetic preparation entry. additionalMappingCodeLines and specialCaseCount stay null with an explicit UNKNOWN reason; comparativeFindings stays null. An absent observation is not measured zero. Existing unmeasured timing fields likewise remain null/UNKNOWN.
- The verifier checks the visible payload/status/code/digest as well as its carried binding, then rederives the whole package from independently retained inputs. A valid inner binding cannot certify forged outer claims. Renderer consistency is not independent verification.
- Each declared context must identify the actual retained rehearsal source bytes. A source label is descriptive, not proof of identity, permission or real-source execution.

The active CLI keeps explicit required inputs and EOF behavior. Its --negative exercises the inherited 19 gates plus five corrective gates. An unexpected gate exits nonzero. JSON/TABLE are local displays; no credential, network, real data or productive write is accepted.

## Evidence and continuation

The original three machine counterexamples are retained in the independent admission audit. The corrected tests cover relabeling with unchanged and rewritten strings, both contexts with missing/revoked grants, null effort, forged outer fields, coherently resealed false real-pilot claims, substituted source bytes and the actual CLI. The unchanged authored-input counterpart still executes the same released metric path against an independent fixture arithmetic oracle.

Historical module, fixture and original CLI hashes are recorded in `ks250-metric-pilot-v1-frozen.json`; existing v1 tests remain replayable against the frozen CLI. The canonical package command stays byte-identical; active tests follow one imported-parent route through source-map.

Real source-owner permission for each exact context, independent metric confirmation, uncoached reader responses, actual observed time/mapping work and separately authorized sanitized disclosure are still required. Resume only on those inputs; do not infer them from schema/digest validity, labels, approval-shaped fixtures or passing machine tests. #236 owns reader acceptance; #167 promotion remains separate. The negative restricted-mode result in #248 grants no new restricted-mode authority.

## Applicable crossings

This increment stays inside admitted local synthetic preparation and the existing maintainer release lane. No source connection, productive effect, external access right, credential custody, training, remote runtime activation or public comparative finding is introduced. Applicable authority/truthfulness/data-minimization/delivery crossings retain the existing #250 Canon map (CM-CAN-01,02,04,09,16,19,24,27); untriggered real-source gates stay unassessed/blocked, not silently qualified. Robotik/Kev/VL/Megapresse remain outside scope.

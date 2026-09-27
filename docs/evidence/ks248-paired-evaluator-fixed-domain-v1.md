# KS248 evaluator-owned paired read subset — local candidate only

A disjoint public calibration case (default, unpaired) and two evaluator-owned blind cases
(actual fixed-domain paired SQL read, one-cent substituted source) are frozen separately
from the maintained expected outcomes. The holdout is read only by the test; it is never
passed to the producer or consumer CLI. The positive read traverses the exact PAN v6
BoundTaskHandleResolver and the KS SQL/lineage entry point with pinned local PGlite. The
holdout's two period nets, delta, counts and no-effect status match the independently
calculated integer fold over the frozen source fixture. A one-cent changed row is refused
at producer source scope before SQL; the result cannot be mislabeled a completed read.

The existing KS248 access-mode comparison uses DIFFERENT synthetic segment bytes from the
PAN v6 fixed unfamiliar-schema task. This subset does NOT assert a shared metadata or
aggregate task: passing such a mode to the paired CLI is refused, not silently accepted.
Consequently it does not close KS-EVO-03-AC01..05, measure human/agent work or cost, or
establish effects/target state. Evaluator-owned public fixture is not a third-party blind
assessment. Any broader independently varied paired case needs an explicitly revised
producer contract and new reviewed expectations; do not rebind another source by a digest
alone. No external data, runtime expansion, PR, release or host effect is claimed here.

Execute locally with clean pinned PAN v6 checkout and KS255 PGlite:
`KS247_PRODUCER_CHECKOUT=<checkout> KS247_PGLITE_PATH=<module> node --test tests/ks248-paired-blind-evaluator.test.mjs`.

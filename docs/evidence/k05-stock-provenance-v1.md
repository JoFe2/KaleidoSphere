# K05 stock provenance and deadline analysis

The stock CLI is additive and read-only. Rollback is to stop invoking it; no operational stock movement is made by KaleidoSphere.

## Separate admitted paths

1. Native COMMON-TRADE-01: existing exact public PAN520 source commit cf199bbd35706bdeadb04679af7354c94caf482a, tree e8e75614ffb8f1d71a6715413386bfd5619e1c3e, checked against contracts/dependencies/pan520-stock-source-v1.json. A real disposable producer ledger records receipts, reservation and issues; the stock reader exposes the exact producer facts/digest/event provenance. Producer quarantine is explicitly named blocked in the additive stock view. Raw facts are unchanged. Neither source metadata nor copied plans grant execution/write authority.
2. Declared synthetic deadline source: K05-DEMAND-ON-TIME / K05-DEMAND-LATE. The two reserved units are explicitly a scenario assumption, not event evidence. Same-cutoff physical/reserved/blocked/free is 2/2/0/0. Independent oracle: demand six minus reserved coverage two minus incoming four only if available by the commitment deadline = zero on-time, four late. The native STOCK profile has no committed-demand/arrival projection and therefore keeps shortage UNKNOWN; this separate source does not invent native demand provenance.
3. Historical narrow M3: K05-HISTORICAL-NARROW-M3 contains the actual output of the unchanged bundled M3 calculator for a declared local synthetic observation. The retained profile has no distinct quarantine/event evidence. Physical is declared; K05 reserved, blocked and free remain UNKNOWN rather than treating combined M3 reservation as two disjoint buckets. No M3 source/kind/schema is extended.

History-less runway and valuation-profile-less stock value are UNKNOWN (null), not zero. Raw native unavailable facts remain UNAVAILABLE; the consumer's explicit analysis fields use UNKNOWN. Missing or incomplete deadline provenance never becomes a known zero.

## Executable entries

    node scripts/run-stock-analysis.mjs --producer-source <exact-public-PAN520-checkout> --native-root <owned-disposable-native-root> --as-of 2026-06-30T23:59:59+02:00
    node scripts/run-stock-analysis.mjs --fixture K05-DEMAND-ON-TIME --as-of 2026-06-30T23:59:59+02:00
    node scripts/run-stock-analysis.mjs --fixture K05-DEMAND-LATE --as-of 2026-06-30T23:59:59+02:00
    node scripts/run-stock-analysis.mjs --fixture K05-HISTORICAL-NARROW-M3 --as-of 2026-06-30T21:59:59Z

Native table/export routes reflect the same unmodified facts. Synthetic routes permit aggregate-only reads of the hash-bound bundled fixture; mixed modes, arbitrary fixture/source paths, caller roles, raw SQL, changed bytes, symlinks and special files are refused.

## Original acceptance evidence map

- AC1: actual native June snapshot + same-cutoff declared synthetic stock, checked independently as 2/2/0/0.
- AC2: actual declared fixture CLI compares zero on-time against four late with independent constants, and exact-deadline equality/one-second-late checks. Supply is consumed once and earlier backlog is retained. Missing provenance is UNKNOWN.
- AC3: unknown runway and valuation explicitly verified in both native and synthetic products.
- AC4: real PAN515/PAN520 snapshot, SQL readback and event digests agree; native rows remain unchanged by analysis.
- AC5: native June 2/2/0/0 and July 1/0/1/0, July quarantine never free and no backward inclusion; historical narrow M3 unknowns preserved.
- Original negatives: a scenario reservation cannot be relabeled event evidence; quarantine cannot be free; later incoming does not cover earlier deadline/cutoff; missing price is not zero; inconsistent/doubly subtracted stock is refused or incomplete disjoint provenance remains UNKNOWN.

Six stock suites are reached once through the immutable canonical source-map parent and explicitly in mandatory CI. No suite skip, provider call, productive source, native stock movement, new rights or Main-preapproval gate is introduced. Local execution/review is not hosted CI, merge or release acceptance.

# KS93 remote-connector terminal decision

## Decision

- Terminal package disposition: `REJECTED_WITH_EVIDENCE`.
- Execution decision: `NO_GO` (machine verdict `REJECT`).
- Decision owner: Jo, as final issue #93 product decision owner.
- Affected scope: every present implementation, procurement, endpoint, External API v2 change, credential or customer-data flow, deployment, activation, support, compliance-readiness, and production-readiness proposal in the remote-connector family.
- Requirements status: valid planning documentation remains `FUTURE_BACKLOG`; it is not implementation authority.

Released #89-#92 evidence consistently rejects implementation now. Required product, architecture, tenant-isolation, security/privacy/license, data-owner, custody, egress, legal/compliance, operations, support, cost, rollback, and final implementation approvals or proofs are absent. Internal schema, digest, fixture, and focused-test checks may be `VALIDATED`; they are not a `RELEASED` capability and do not change the terminal rejection.

## Exact released citations

| FRC | Issue / release / main SHA | Current-checkout artifact and SHA-256 | Exact anchor |
| --- | --- | --- | --- |
| `FRC.0` | #89 / `2026_08_30_v1` / `eb200aa4c3bb206c4bec70a6b92b73a89453d55e` | `docs/future/remote-connector/PRODUCT_BOUNDARY_THREAT_MODEL.md` / `sha256:97ca82d288050233e50eac314e080afb43352b516bd4816e422f76eb18e604ce` | `### 12.1 Terminal recommendation for this discovery artifact` |
| `FRC.1` | #90 / `2026_08_30_v2` / `5f75e1261585bf5464ef8b3fa3d4d220c21dde9a` | `docs/future/remote-connector/IDENTITY_AUTHORITY_RECEIPTS.md` / `sha256:8bcf41343763ef9c38ffbe7f51671d8e8c5ee52c415960138cde092c689fda30` | `### Issue #90 discovery disposition` |
| `FRC.2` | #91 / `2026_08_30_v3` / `664447988841eed2f9023f29ab7ba7025562e524` | `docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md` / `sha256:fffe23a0f386601e5cc502219bef2f462b13fd487b09aa3dfe5642d7e41e6a84` | `### Issue #91 implementation disposition` |
| `FRC.3` | #92 / `2026_08_30_v4` / `f5a1363e3f29114def0054d4d817abb93818a2a1` | `docs/future/remote-connector/SYNTHETIC_SPIKE_AUTHORIZATION_PACKET.md` / `sha256:21d7524b7faf0fd677609d57ce69de83de92f51dc644dce920d565cdeaabb4ce` | `## Current prerequisite decision` |

The validator checks these digests against current-checkout bytes. Release SHAs are immutable provenance metadata; intermediate commits and local `.git` history are not required.

## Risks, cost, compliance, support, and rollback

- **Risks:** authority confusion, cross-tenant exposure, unsafe custody/egress, unsupported operation, and false readiness remain unaccepted.
- **Costs:** implementation, hosting, compliance, support, incident, continuity, procurement, exit, and rollback costs are not approved or sustainably staffed.
- **Compliance:** no legal, privacy, residency, retention, tenant-isolation, or compliance-readiness conclusion exists.
- **Support:** no accountable hosted operator, service level, on-call, maintenance, incident, continuity, or decommissioning posture exists.
- **Rollback:** because nothing is authorized or running, rollback is “do not start”; later documentation may supersede this artifact, but no runtime rollback capability is claimed.

## Authorization firewall and mandatory negatives

Every implementation child, without exception, remains blocked until a new immutable proposal receives separate explicit authorization from **Jo, Product, and Security**. Each child needs its own three records; no record is inherited, embedded, caller-authored, or reused from discovery.

The following can never serve as approval: discovery completion; this decision or a local validation; endpoint creation; External API v2 widening; credentials or customer data; caller-authored authority, booleans, expected values, summaries, or assertions; deployment readiness; compliance readiness; production readiness; or a planning artifact marked `FUTURE_BACKLOG`.

## Supersession

Only Jo, Product, and Security may jointly authorize reconsideration of one immutable child after all applicable released blockers are closed by independently owned evidence, risks and costs are accepted, compliance/support/rollback are explicit, and canonical delivery gates are defined. Reconsideration does not itself authorize implementation. This decision supersedes the synthetic GO-eligible interpretation in the historical KS93 package family.

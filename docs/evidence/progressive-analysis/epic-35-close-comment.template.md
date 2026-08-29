# Epic 35 local delivery / closure comment draft

Contract: `epic-35-delivery-packet/v1`

This comment is a pointer to the committed packet, not a second authority.
The packet is the canonical SHA-bound record. Replace every placeholder before
posting. Use exact provider identifiers and repository-relative evidence refs;
do not paste source records, sensitive material, statement text, or unjoined
provider prose.

## Packet and slice lineage

- packet path: `docs/evidence/progressive-analysis/epic-35-delivery-packet.json`
- packet terminal hash: `<64-lowercase-hex-sha256>`
- exact base SHA (`origin/main` at slice cut): `<40-lowercase-hex>`
- exact reviewed task head SHA: `<40-lowercase-hex>`
- contract version: `epic-35-delivery-packet/v1`
- task id: `QWEN-KS-35-DELIVERY-PACKET-06`
- changed paths: the three paths listed in `work_receipt.changed_paths`
- critical path: `#36 -> #37 -> #38 -> #39 -> #40`
- closure decision: `<eligible|not_eligible>`

The packet terminal hash is recomputed after all substitutions. The exact base
and reviewed-head SHAs must be equal to both `lineage` and `work_receipt`; no
branch name or moving ref is a substitute.

## Child delivery join

Copy one row for each of **#36, #37, #38, #39, and #40**, in ascending issue
order. Every row must link the exact evidence refs recorded in the packet.

| child | dependencies | disposition | protected PR or durable no-delivery rationale | deterministic fixture + SHA-256 | rejected negative-probe receipt | exact-head CI (run + SHA + success) | exact-main CI (run + SHA + success) | release decision | public readback |
|---|---|---|---|---|---|---|---|---|---|
| #36 | `[]` | `<merged|closed_no_delivery>` | `<PR number + head/merge SHA, or rationale reason code + evidence ref>` | `<fixture ref + 64-hex digest>` | `<probe id + evidence ref>` | `<run id + PR head SHA>` | `<run id + merge SHA>` | `<released|no_release>` | `<readback id + tag/tag SHA, or null>` |
| #37 | `[36]` | `<merged|closed_no_delivery>` | `<PR number + head/merge SHA, or rationale reason code + evidence ref>` | `<fixture ref + 64-hex digest>` | `<probe id + evidence ref>` | `<run id + PR head SHA>` | `<run id + merge SHA>` | `<released|no_release>` | `<readback id + tag/tag SHA, or null>` |
| #38 | `[36, 37]` | `<merged|closed_no_delivery>` | `<PR number + head/merge SHA, or rationale reason code + evidence ref>` | `<fixture ref + 64-hex digest>` | `<probe id + evidence ref>` | `<run id + PR head SHA>` | `<run id + merge SHA>` | `<released|no_release>` | `<readback id + tag/tag SHA, or null>` |
| #39 | `[36, 37, 38]` | `<merged|closed_no_delivery>` | `<PR number + head/merge SHA, or rationale reason code + evidence ref>` | `<fixture ref + 64-hex digest>` | `<probe id + evidence ref>` | `<run id + PR head SHA>` | `<run id + merge SHA>` | `<released|no_release>` | `<readback id + tag/tag SHA, or null>` |
| #40 | `[36, 37, 38, 39]` | `<merged|closed_no_delivery>` | `<PR number + head/merge SHA, or rationale reason code + evidence ref>` | `<fixture ref + 64-hex digest>` | `<probe id + evidence ref>` | `<run id + PR head SHA>` | `<run id + merge SHA>` | `<released|no_release>` | `<readback id + tag/tag SHA, or null>` |

A merged child requires `base_ref=main`, `protected=true`, distinct exact
head and merge SHAs, successful exact-head and exact-main CI bound to those
SHAs, deterministic fixture evidence, at least one rejected negative probe,
and an explicit release decision. A `closed_no_delivery` child requires a
durable structured rationale with a stable reason code and evidence refs; its
PR, CI, and release fields are null. Never infer no-delivery from an open issue
or from missing data.

## Dependency and foundation gate

- breadth gate receipt: `<repository-relative evidence ref>`; gated by child
  `36`
- evidence/receipt foundation refs: `<repository-relative evidence refs>`;
  gated by children `[36, 37]`
- parity depth (#38) does not bypass the #36 controller breadth gate
- adaptive drilldown (#40) follows the #36/#37 evidence and receipt
  foundations and the complete preceding edge set

Any absent edge, foundation, or merged dependency is a fail-closed denial; the
comment must not upgrade a child or epic decision beyond the packet.

## Release branch

### Released branch

Use this branch only when the packet has an explicit `released` decision. Copy
the exact epic release tag, tag-target SHA, and successful public readback
receipt from the packet. Each released child must carry the same three kinds of
anchors in its own release decision. The public claim is limited to those
identifiers; it does not assert performance, causality, or customer outcome.

- epic release tag: `<tag>`
- epic tag-target SHA: `<40-lowercase-hex>`
- epic public readback receipt: `<stable-readback-id>`
- public release claim: `authorized only by the packet terminal hash`

### No-release branch

Use this branch when no public release is made. It is valid only when the
packet contains a durable structured rationale with a stable reason code,
at least one repository-relative evidence ref, and a nonclaim-safe statement.
Set `decision.public_release_claim` to `null`, set the epic release decision
to `no_release`, and set every merged child's release decision to `no_release`
with null tag, tag SHA, and public readback. A closed-no-delivery child has
null CI and release fields and its own durable rationale. Do not write a
release URL, tag, or release-success claim in this branch.

- epic release decision: `no_release`
- rationale reason code: `<lowercase-kebab-case>`
- rationale evidence refs: `<repository-relative refs>`
- durable rationale statement: `<nonclaim-safe statement>`
- public release claim: `null`

## External-action readbacks

List every read-only provider action in `external_actions`. For each action,
copy its stable `action_id`, provider, exact observed provider-object
identifier and result, and repository-relative receipt ref. An action without
an exact identifier and joined evidence ref is not a claim and cannot authorize
closure. This record authorizes no dispatch or mutation.

## Remaining nonclaims

Repeat every material nonclaim from the packet here. Safe boundary examples:

- `<this packet does not establish product performance, customer outcome, or causality>`
- `<fixture identifiers are synthetic unless independently read back>`
- `<no action is authorized by this comment; the packet records readbacks only>`
- `<unreleased or closed-no-delivery children remain nonclaims exactly as recorded>`

Do not turn a nonclaim into a causal, performance, completeness, or customer
outcome assertion.

## Posting gate

Before posting, verify that:

1. the packet has exactly children #36 through #40 and the exact dependency
   edge set;
2. every child has either a protected merged PR or a durable closed/no-delivery
   rationale;
3. every merged child has deterministic fixture evidence, a rejected negative
   probe, exact-head/exact-main CI, and an explicit release decision;
4. every released child and the released epic have a successful public
   readback joined to exact tag and tag-target SHA identifiers;
5. a no-release packet has a durable rationale and a null public-release claim;
6. terminal hash, exact base/head lineage, and `work_receipt.changed_paths`
   match the committed packet; and
7. every external action is represented by an exact identifier plus an evidence
   ref, with no raw values, credentials, DDL/DML, free SQL, or causal overclaim.

Missing child, edge, foundation, CI decision, release decision, released
readback, rationale, or terminal-hash match is a fail-closed denial. Keep this
comment synchronized with the committed packet and do not add a stronger
claim in prose than the packet joins.
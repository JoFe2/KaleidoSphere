# Identity Authority Receipts — Planning-Only Boundary Envelope

## Status and purpose

This document is a planning-only future-requirements artifact for a possible remote-connector identity-authority receipt capability. It records boundaries, admission gates, and requirement-level definitions of principals, authority classes, scope, consent lifecycle, delegation controls, receipt signing, and key custody options. It is not an implementation specification, an implementation plan, an authorization, or evidence that the capability exists.

The governing process is Operating Model v1.1, preserving decisions D-001 through D-007. No new process variant is introduced. This requirements envelope remains planning-only; the issue #90 discovery disposition recorded below rejects implementation now without invalidating these requirements.

## Scope boundary

In scope for future requirements discussion:

- Define the problem space for recording which authority asserted an identity or authorization result for a remote connector, including provenance, timestamping, revocation/withdrawal semantics, auditability, and bounded receipt retention questions.
- Define requirement-level distinctions for user, service, and evidence principals and their authority classes, together with the scope, audience/expiry, consent lifecycle, and delegation-control requirements that a later proposal must satisfy.
- Define, at requirements level, the receipt-signing threat model and key-custody options, with evidence signing explicitly separated from execution authority.
- Identify product, security, privacy, and license questions that a later proposal must answer.
- Define reviewable acceptance evidence for any later proposal, without selecting a provider, protocol, endpoint, credential, data source, deployment target, or implementation design.
- Maintain this memo as documentation only at `docs/future/remote-connector/IDENTITY_AUTHORITY_RECEIPTS.md`.

Out of scope:

- Source code, schemas, configuration, dependencies, deployment manifests, infrastructure, CI changes, runtime behavior, or runtime intent changes.
- Registration, configuration, or testing of an OAuth application; selection or integration of an identity provider; operation of a signing service; or connection to any remote service.
- Collection, processing, migration, or retention of customer data or live identity data.
- A claim that an identity authority, OAuth integration, signing service, compliance control, or production capability exists.

## Principals and authority classes

The principal and authority classes below are defined at requirements level for a later proposal. They are requirement distinctions, not identities, accounts, roles, or protocol entities, and none of them is created, provisioned, or bound by this memo.

- **User principal.** The subject whose intent, explicit consent, and withdrawal actions are the source of user authority. User authority is the authority to act for the user principal, bounded by its explicit consent.
- **Service principal.** A future system component that requests and exercises delegated authority. Service authority is the authority to act for a user principal only within a scope that is explicitly delegated, consent-backed, and bounded. A service principal never holds user authority of its own and never holds evidence authority.
- **Evidence principal.** The authority class that records, preserves, and attests authority results, including identity, consent, and revocation evidence, as audit evidence. Evidence authority is the authority to record and attest, not to act.

Authority-class separation rules:

- User, service, and evidence authority are distinct and non-overlapping classes. A scope, consent record, delegation, or receipt names exactly one executing authority class.
- User consent can bound service authority through delegation (see Delegation controls) and cannot grant evidence authority or evidence-class execution rights.
- Evidence authority is not derivable from consent and is not delegable. It is established only by separately approved evidence under the admission and approval gates below.
- Mixing or conflating authority classes within a single grant or record is a fail-closed case (see Fail-closed evaluation cases).

## Scope requirements

Each future scope is a named, narrow authority statement. Every scope must satisfy all of the following; a scope failing any one of them is rejected.

- **Narrow.** A scope names a single bounded action or resource class within a single authority class. Compound, wildcard, catch-all, and default scopes are not permitted.
- **Principal-bound.** A scope names exactly one executing principal and the authority class the scope belongs to.
- **Audience-bound.** A scope names exactly one documented, allowlisted audience — the future destination authorized to accept the scope. Audience is an attribute of the scope, not of a credential or transport.
- **Expiring.** A scope has a documented expiry not later than the expiry of its underlying consent.
- **Non-transferable.** A scope cannot be assigned, handed over, or reissued to another principal except through explicit delegation (see Delegation controls).
- **Consent-backed.** A scope requires explicit consent evidence from the corresponding user principal (see Consent lifecycle).

## Audience and expiry binding

- **Audience binding is exact.** The scope's documented audience and the audience of the requesting context must match exactly; partial, superset, subset, and alias-based matching are not permitted. Mismatch is rejected as audience mismatch.
- **Expiry is evaluated at each presentation.** A scope is valid only within its open interval from consent grant to its documented expiry, evaluated against a documented time source. An expired scope is rejected without grace, renewal, or implicit re-grant.
- **Neither audience nor expiry is extendable by service action.** Extension requires new consent evidence from the user principal, recorded as a new consent grant with its own documented audience and expiry.

## Consent lifecycle

Consent is the user principal's explicit, documented grant of a bounded scope to a named service principal for a named audience. The lifecycle is defined at requirements level; no protocol or provider is selected.

- **Capture.** Consent is captured only as an explicit affirmative act of the user principal. Capture evidence records the consent subject, the granted scope (narrow, principal-bound, audience-bound, expiring), the audience, the expiry, the capture time against a documented time source, and the channel by which the affirmative act was established. Silence, inactivity, defaults, or inference from another grant are not capture. Capture evidence missing any of these fields is missing and is rejected.
- **Presentation.** To exercise a scope, the consent evidence must be presentable with the scope. Presentation binds the presenting service principal, the requested scope, the audience, and the evaluation time, and must match the recorded principal, scope, audience, and unexpired lifetime.
- **Withdrawal.** The user principal may withdraw consent at any time, in whole or per scope. Withdrawal is an explicit affirmative act and produces withdrawal evidence recording the withdrawn scope, subject, time, and channel.
- **Audit evidence.** Capture, presentation, and withdrawal each produce audit-evidence records maintained under the evidence authority. Audit records are append-only at requirements level: records are not amended or deleted in place; corrections occur only as new records referencing the original.
- **Revocation input.** Withdrawal evidence is defined as input to revocation processing, which consumes withdrawal evidence to invalidate the corresponding scope(s) and all delegations derived from them. Until revocation processing has consumed the withdrawal evidence, the affected scope is treated as withdrawn for fail-closed evaluation. Revocation processing is a separately approved future capability and is not defined, provisioned, or approved by this memo.

## Delegation controls

- Delegation is the only mechanism by which service authority moves from one principal to another. A delegation is always a subset of the delegating principal's consented scope, never an extension.
- Delegation is explicit and recorded as its own consent-backed evidence naming the delegating principal, the delegatee principal, the delegated scope, the audience, and an expiry not later than the delegating scope's expiry.
- Delegation does not cross authority classes. It cannot grant evidence authority and cannot convert user authority into a different authority class.
- Transitive delegation (delegating a delegated scope) requires fresh explicit consent evidence at each hop; implicit transitivity is rejected.
- Delegations are revocable by the original user principal. Withdrawal of the underlying consent revokes all delegations derived from it.

## Receipt signing and evidence authority

Receipt signing is defined only as evidence of a recorded decision or result under the evidence principal. A receipt is a signed record attesting that a recorded decision or result — such as a consent capture, consent presentation, withdrawal, delegation record, or revocation-processing result — was recorded by a named signer at a recorded time. Receipt signing is the act of producing that signed record; verification is the act of checking the signed record against the recorded evidence context.

Authority separation for receipts:

- Receipt signing is evidence authority. It belongs only to the evidence principal, is not derivable from consent, and is not delegable to a user or service principal.
- A receipt is never a command, never a permission, and never execution authority. Signing a receipt does not perform the recorded operation, and presenting a verified receipt does not grant the presenter any right to perform any operation.
- A valid receipt signature does not imply execution authority. Verifying a receipt establishes only that the recorded decision or result was attested by the named signer in the recorded context; it does not establish consent, scope, delegation, or permission for any further action.
- A verifier that validates the evidence context of a receipt acquires no permission to perform an operation. The verifier's output is limited to an evidence attestation about the record itself.
- A receipt record names exactly one executing authority class — the evidence class. A receipt that names a user or service authority class as the executing class of the receipt itself is a mixed-authority-class fail-closed case (see Fail-closed evaluation cases).
- A receipt may attest to a recorded decision or result only. It cannot extend, renew, or re-grant a scope or consent, and it is not consent evidence for a new scope.

## Receipt threat model and mitigations

The threat model is defined at requirements level for a later proposal. Each threat names the failure mode and the mitigations a later design must satisfy; a design that fails any mitigation fails closed. No threat or mitigation in this section implies an existing control, key, service, or production capability.

- **Forgery.** An attacker produces a record claiming to be a receipt signed by a legitimate signer. Mitigations: a receipt is verified only against a recorded signer identity and its verification metadata; a receipt from an unknown, unrecorded, or revoked signer is rejected; signer identity and algorithm policy are documented as identifiers, and a verifier must reject any record whose signer identity cannot be resolved to a recorded entry.
- **Alteration.** A receipt is modified after signing — content, context binding, or verification metadata. Mitigations: the signature covers the complete canonical receipt payload, including the recorded decision or result, the context binding, the verification metadata, and the issuance time; any canonicalization or content mismatch is rejected; receipts are append-only evidence, so corrections occur only as new records referencing the original.
- **Substitution.** A receipt for one recorded decision or result is presented as evidence for a different decision, principal, or context. Mitigation: receipts are context-bound — a receipt names the decision or result identifier, the principal, the authority class, the audience, and the issuance context — and a verifier must reject a receipt unless every bound field exactly matches the recorded evidence context being validated.
- **Replay or stale receipt.** A previously presented, expired, or superseded receipt is re-presented, or a receipt is presented after its underlying recorded decision or result has been withdrawn or superseded. Mitigations: a receipt carries an issuance time and an evaluation window against a documented time source; revocation state is evaluated at each presentation; a receipt referencing a withdrawn or superseded record is rejected; a non-revoked receipt re-presented in a context that does not exactly match its bound context is rejected (see Fail-closed evaluation cases).
- **Signer compromise.** The signing key or signing process of a recorded signer is compromised. Mitigations: signer compromise is treated as an incident that revokes the affected signer identity; all receipts issued by a revoked signer are rejected once the revocation is recorded; the signing process is isolated and access-restricted per the selected key-custody option; compromise response is defined before implementation review.
- **Key disclosure.** Secret signing material is exposed in a receipt, log, record, or example. Mitigations: the presence of secret material in a receipt or record is a fail-closed case (see Fail-closed evaluation cases); key material is never copied into receipts, audit records, or planning artifacts; verification metadata references signer identity and policy as identifiers only, never as material; placeholder prose remains non-functional and non-secret.
- **Missing rotation/revocation.** A stale signing key or signer identity remains trusted because no rotation or revocation mechanism exists. Mitigations: documented rotation and revocation for signer identities and their verification metadata are mandatory requirements of any later design; verifiers must consult recorded revocation state; the absence of a revocation mechanism or of revocation state is fail-closed and rejects the receipt.
- **Authority confusion.** A receipt or its signature is treated as conferring execution authority, permission, or scope. Mitigations: the authority-class separation rules above apply to receipts and their verification; any treatment of a receipt as a command, permission, token, or execution authority is rejected (see Fail-closed evaluation cases); a verifier's output is limited to an evidence attestation and never to an authorization result.

## Key custody options (future comparison, unselected)

Key custody is the set of controls governing how secret signing material is held, used, and protected in a future receipt-signing design. The options below are compared at requirements level as future options. This comparison does not select a custody model, does not select an algorithm, and does not generate, provision, or reference a live key, seed, or certificate. Selecting a custody option, or provisioning any key, requires the security authorization gate and is out of scope for this memo.

- **Managed isolated custody.** Signing material is held in a dedicated, isolated, access-controlled signing environment with strict access control, audit logging, and no export path for secret material. Trade-offs: operational convenience and remote availability for signing and verification; a larger trust boundary because the managed environment itself must pass security authorization and monitoring; a compromise of the environment is a signer-compromise incident for every signer it hosts.
- **Hardware-backed custody.** Signing material is stored in, and used within, hardware-backed protection (for example, a hardware security module, secure element, or trusted execution environment); secret material is non-exportable and operations are performed inside the protected boundary. Trade-offs: minimal secret exposure and strongest non-exportability; algorithm and protocol support is limited to what the protected boundary supports; hardware lifecycle (loss, damage, end of life) requires recovery and reissue policy; availability depends on the protected boundary and its attestation policy.
- **Offline root with delegated signing.** A root signing identity is held offline and used only in controlled ceremonies; delegated signing identities are issued from the root for bounded lifetimes and bounded scopes; all delegated identities are revocable. Trade-offs: strongest compromise containment for the root because the root does not perform routine signing; an added delegation hierarchy with its own issuance, rotation, and revocation semantics; operational cost of signing ceremonies and of maintaining the delegation chain; revocation state for delegated identities must be consultable at every verification.

Comparison constraints:

- Any later proposal must evaluate its selected option against the full threat model above and the mandatory verification metadata below.
- No option in this comparison is a selection, recommendation, or approval. An option that is not separately approved under the security authorization gate is not available.
- No key, seed, certificate, bearer token, or live credential is created, referenced, or implied by this comparison.

## Mandatory receipt verification metadata

A later receipt design must include all of the following verification metadata in every receipt. Each field is a requirement on record content; none of the fields may contain real key material, secret material, a bearer token, a certificate, or customer receipt content. Examples in any later artifact must use abstract, non-functional, non-secret placeholders.

- **Verification metadata.** The algorithm policy identifier, the verification context, and the documented time-source reference used for evaluation, recorded as policy identifiers rather than material.
- **Signer identity.** The recorded signer identity naming the evidence principal that produced the receipt, as an identifier resolvable in the recorded signer registry. Key material is not part of signer identity.
- **Context binding.** The decision or result identifier, the principal, the authority class (evidence only), the audience, and the issuance context that the receipt attests.
- **Rotation/revocation.** A revocation-status reference and a rotation-generation identifier for the signer identity, so that revocation state can be consulted at each presentation.
- **Audit correlation.** A reference to the append-only audit record the receipt correlates with, so the receipt can be correlated with the capture, presentation, or withdrawal audit trail under the evidence principal.

A receipt missing any of these fields is missing and is rejected. A field containing real key material, secret material, a bearer token, a certificate, or customer receipt content is a fail-closed case and the record is rejected.

## Fail-closed evaluation cases

All future scope, consent, delegation, and receipt evaluations fail closed: in doubt, reject. The following cases are explicit rejections.

**Missing or invalid scope.**

- A scope with no named principal, no documented audience, or no documented expiry is rejected as missing.
- An expired scope is rejected.
- A scope presented to an audience that does not exactly match its documented audience is rejected as audience mismatch.
- A scope that requests more than the consented scope, or whose executing authority class exceeds the authority class granted by consent, is rejected as elevated.
- A scope without explicit consent evidence from the corresponding user principal is rejected as unconsented.

**Mixed authority classes.**

- A scope, consent record, delegation, or receipt that names more than one executing authority class, or that conflates user, service, and evidence authority in one grant, is rejected.
- A consent grant that attempts to confer evidence-authority execution rights is rejected. Consent can bound service authority only and cannot confer evidence authority.

**Receipt signing and evidence authority.**

- A receipt, receipt signature, or receipt verification treated as a command, permission, token, or execution authority for any operation is rejected: a valid receipt signature does not imply execution authority, and validating a receipt grants the verifier no permission to perform an operation.
- A receipt that names an executing authority class other than the evidence class for the receipt itself is rejected as a mixed authority class.
- A non-revoked receipt re-presented in a context that does not exactly match its bound context, or re-presented after its underlying recorded decision or result has been withdrawn or superseded, is rejected as an unrevoked replay. Absence of revocation does not re-authorize a replay.
- A receipt, verification metadata, or example that contains real key material, seed material, a bearer token, a certificate, or customer receipt content is rejected. A long-lived bearer token is forbidden in any receipt, record, or example.
- A receipt, record, or this memo that asserts a compliance-readiness or production-capability claim unsupported by separately approved evidence is rejected. Compliance or production claims are never inferable from a receipt or its verification.

**Live credentials and tokens.**

- The presence of a live credential, token, key, or secret in a consent record, scope descriptor, delegation record, receipt, or audit-evidence record is a fail-closed case: the record is rejected and the material must not be copied, normalized, or retained in the record. Placeholder prose remains non-functional and non-secret, consistent with the guardrails above.

**Implicit approval.**

- No gate, authorization, or implementation approval is inferable from any consent record, scope, delegation, receipt, or from this memo. Absence of explicit approval at any gate fails closed and stops work at the unmet gate.

**Acceptance cases.**

- A consented narrow scope bound to the requesting principal and a documented audience, unexpired at presentation and fully consent-backed, is an accepted presentation.
- Withdrawal evidence naming the withdrawn scope and identified as input to revocation processing is an accepted withdrawal record.
- A receipt whose signature validates against a recorded signer identity, whose context binding exactly matches the recorded evidence context, and which is unexpired and unrevoked at presentation, is an accepted evidence record; its validation does not grant the verifier any permission to perform an operation.
- The key-custody comparison, which identifies trade-offs among managed isolated custody, hardware-backed custody, and offline root with delegated signing without selecting a custody model or provisioning a live key, is an accepted planning artifact.

## Mandatory admission and approval gates

The gates are separate and cumulative. Passing one gate does not satisfy or imply any other gate.

1. **Future-backlog admission:** Issue #79 must be explicitly admitted to `FUTURE_BACKLOG` under the governing operating model. This memo alone does not constitute that admission. Until the admission is recorded, no implementation proposal may be prepared.
2. **Product authorization:** After #79 admission, a product owner must separately approve the user need, bounded scope, expected users/tenants, acceptance criteria, lifecycle/withdrawal behavior, and data-minimization requirements. Product authorization must be recorded as evidence; discussion in this memo is not product approval.
3. **Security authorization:** Separately from product authorization, a security/privacy/license review must approve the threat model, trust and authority boundaries, credential handling, privacy impact, retention and deletion controls, incident/revocation handling, applicable compliance obligations, and third-party/license posture. Security authorization must be recorded as evidence; this memo is not security approval.
4. **Implementation proposal and implementation approval:** Only after #79 FUTURE_BACKLOG admission and both separate product and security authorizations may a bounded implementation proposal be authored. The proposal must then receive a separate implementation approval before any code, configuration, credential, integration, deployment, or runtime-intent change is made. No such implementation approval is granted here.

Missing, stale, contradictory, or unapproved evidence fails closed: work stops at the unmet gate and no later gate is inferred.

## Security, privacy, and license guardrails

- This artifact creates no credentials, secrets, tokens, live keys, signing material, OAuth application registration (OAuth app registration), endpoint, remote service, or network action. Placeholder prose must remain non-functional and non-secret.
- A long-lived bearer token in logs or configuration is forbidden; it must not be copied, exposed, or “normalized” into a placeholder, redaction convention, fixture, or accepted requirement. Any eventual credential design would require explicit security approval for issuance, scope, lifetime, storage, rotation, revocation, and logging behavior.
- No customer data, personal data, tenant data, real identity subject, production identifier, authentication assertion, or live receipt is collected, copied, stored, or transmitted by this planning artifact. Future examples must be abstract and non-sensitive.
- No endpoint, URL intended for a live service, provider account, OAuth client, remote call, or service-to-service trust is created or tested. A future proposal must specify allowlisted destinations, egress controls, failure behavior, and operator ownership and obtain security approval before any connection.
- No signing service or production identity is provisioned or implied. Any later signing or verification design must define key custody, algorithm policy, compromise response, revocation, and audit evidence before implementation review.
- No dependency, SDK, provider terms, copied vendor material, or license obligation is introduced. A later proposal must provide a complete dependency and license inventory and receive license approval before adding third-party material.
- Privacy review must establish purpose limitation, data minimization, lawful handling, tenant isolation, retention, deletion, access control, and audit treatment before any real identity or receipt data is considered.
- Security and privacy controls are requirements for a possible future proposal, not evidence of compliance readiness. They do not authorize implementation or production use.

## Explicit non-claims

This memo does not claim, create, or authorize any of the following:

- production identity;
- OAuth integration or OAuth application registration;
- a signing service;
- compliance readiness;
- authorization to implement;
- implementation approval or product approval;
- production readiness or a production deployment;
- credentials, live keys, customer data, an endpoint, a remote service, or a runtime-intent change; or
- a `RELEASED` state for this capability or any premature release claim.

In particular, the existence, review, or commit of this memo is not proof that an identity authority is trusted, that an authorization result is valid, that a receipt is legally or operationally sufficient, or that any remote connector can be used.

## Terminal dispositions and evidence

The only terminal dispositions for this planning artifact are:

- **`RELEASED`** — permitted only when separately approved evidence demonstrates #79 FUTURE_BACKLOG admission, product authorization, security/privacy/license authorization, the approved implementation gate, and the explicitly bounded release criteria. This memo cannot confer `RELEASED`.
- **`REJECTED_WITH_EVIDENCE`** — permitted only when separately approved evidence records the rejection decision, decision owner, reasons, affected scope, and any required follow-up or supersession. Absence of approval, silence, withdrawal, or an incomplete review is not evidence for this disposition.

Withdrawal or supersession is a lifecycle action, not a third terminal disposition and not an implicit rejection.

### Issue #90 discovery disposition

- **Disposition:** `REJECTED_WITH_EVIDENCE` for implementing remote OAuth identity integration or receipt signing now. The requirements artifact itself remains valid documentation in `FUTURE_BACKLOG`; the rejection applies to present implementation, procurement, activation, and runtime work, not to the requirements recorded above.
- **Evidence binding:** the released issue #89 discovery decision in `docs/future/remote-connector/PRODUCT_BOUNDARY_THREAT_MODEL.md`, published by KaleidoSphere release `2026_08_30_v1` at `main` commit `eb200aa4c3bb206c4bec70a6b92b73a89453d55e`, records `DEFER/REJECT-NOW` and preserves the candidate as `FUTURE_BACKLOG`.
- **Decision owner:** the product owner, as the owner assigned to maintain the #89 reject/defer backlog decision.
- **Reasons:** required product, architecture, security/privacy/license, data-owner, operations, procurement, and final implementation approvals are not granted; tenant identity and isolation are not implemented or proven; no approved custody model exists for access or signing material; customer-data purpose, handling, and source authority are not approved; and no accountable hosted operations, support, incident, continuity, or rollback/readback posture exists.
- **Affected scope:** any implementation proposal, source code, schema, OAuth application or provider integration, receipt-signing or verification service, credential or key custody, endpoint or remote connection, customer-data processing, deployment, production activation, or procurement for the remote identity-authority receipt capability.
- **Supersession conditions:** reconsideration requires a separately authorized work item that clears every applicable #89 implementation blocker, records every required approval from its accountable owner for one immutable proposal, validates a bounded customer need and approved risk/cost envelope, demonstrates fail-closed tenant/principal/request/resource/capability/evidence binding, establishes custody, data handling, operations, incident, continuity, rollback/exit, and independent readback evidence, and reruns the normalized option comparison against then-current architecture and market evidence. Meeting those conditions permits reconsideration only; it does not itself select an option or authorize implementation.
- **Nonclaims:** this disposition does not claim that OAuth, an identity authority, receipt signing, revocation processing, key custody, customer-data handling, an endpoint, remote transport, deployment, or production capability exists; it grants no product, security, privacy, license, data-owner, operations, procurement, implementation, or release approval; it makes no compliance or production-readiness claim; and it does not invalidate or withdraw this requirements artifact.

## Withdrawal, supersession, and rollback

Withdrawal or supersession is the only local rollback for this planning artifact. A withdrawal makes this memo non-actionable; a superseding approved planning artifact replaces its applicability. Either action must identify the reason, effective scope, and authoritative replacement or withdrawal evidence, while preserving repository history where available.

Because this memo creates no external state, there is no remote, credential, data, endpoint, service, deployment, or runtime rollback to perform. Withdrawal or supersession must not be interpreted as permission to implement, as proof of a security decision, or as `REJECTED_WITH_EVIDENCE`. Any later terminal disposition requires separately approved evidence under the terminal-disposition rules above; it may not be inferred from this rollback action.

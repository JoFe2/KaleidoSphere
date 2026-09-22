import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
/**
 * M0 – anchored fachmodule convention (see docs/development/fachmodule-m0-m4-regelwerk.md).
 *
 * A narrow, versioned, closed Zuordnungsprofil (assignment profile, Regelwerk §4).
 * It binds ONE concrete source/target contract pair, declares closed field mappings
 * by semantic identity (never by word similarity), declares the transformations and
 * losses, and states a compatibility verdict for that pair + profile only.
 *
 * This is a DESCRIPTION-level anchor (contractOnly), not a runtime connector:
 * it grants no data-access right, no authority, and no real-integration claim.
 * Definition reuse here does NOT imply a runtime dependency (Regelwerk §3).
 *
 * It is the minimal executable contract/profile check the first real user case
 * (M1 procurement / goods receipt / invoice reconciliation) needs: a shared,
 * tightly fixed Anschlussdefinition for composing the reused erp-read fact
 * reader with the reused ERV reconciliation core, BEFORE parallel M1 work.
 *
 * Semantic binding (review finding F3): `applyFachprofilToErpReadInvoiceV1`
 * executes ONLY the exact frozen M0 semantic identity
 * (FROZEN_FACHPROFIL_IDENTITY_DIGEST_V1) — the approved source/target pair,
 * the exact fieldMaps and the exact declaredLosses. A self-consistent
 * digest is not an approved semantic mapping; a caller-rehashed profile with
 * an altered source, compatibility, or emptied fieldMaps/losses is denied
 * (PROFILE_IDENTITY_NOT_FROZEN) instead of silently running the frozen
 * mapping while suppressing its losses.
 */
export const FACHPROFIL_MAPPING_SCHEMA_V1 = "chimpmaera.fachprofil/mapping/v1";
const sha = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export function fachprofilMappingDigestV1(value) {
    const rest = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "profileDigest"));
    return sha(rest);
}
const isString = (v) => typeof v === "string" && v.length > 0;
const COMPAT = ["DIRECT", "TRANSFORMED", "LOSSY_REQUIRES_DECISION", "UNRESOLVED"];
const TRANSFORM = ["IDENTITY", "CURRENCY_EUR_MINOR"];
function fieldMapOk(v) {
    if (typeof v !== "object" || v === null)
        return false;
    const m = v;
    return isString(m.sourceField) && isString(m.targetField) && isString(m.identity)
        && typeof m.transform === "string" && TRANSFORM.includes(m.transform);
}
function lossOk(v) {
    if (typeof v !== "object" || v === null)
        return false;
    const m = v;
    return isString(m.targetField) && isString(m.reasonCode) && isString(m.detail);
}
/** Closed structural + digest verification. Unknown fields are rejected. */
export function verifyFachprofilMappingV1(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const v = value;
    const keys = Object.keys(v).sort();
    const expected = [
        "compatibility", "contractOnly", "declaredLosses", "fieldMaps", "nonScope",
        "profileDigest", "profileId", "purpose", "schemaVersion", "source", "target",
    ].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expected))
        return false;
    if (v.schemaVersion !== FACHPROFIL_MAPPING_SCHEMA_V1)
        return false;
    if (!isString(v.profileId) || !isString(v.purpose) || !isString(v.nonScope))
        return false;
    if (v.contractOnly !== true)
        return false;
    if (typeof v.compatibility !== "string" || !COMPAT.includes(v.compatibility))
        return false;
    if (!Array.isArray(v.fieldMaps) || v.fieldMaps.some((f) => !fieldMapOk(f)))
        return false;
    if (!Array.isArray(v.declaredLosses) || v.declaredLosses.some((l) => !lossOk(l)))
        return false;
    const src = v.source;
    const tgt = v.target;
    if (typeof src !== "object" || src === null || typeof tgt !== "object" || tgt === null)
        return false;
    const s = src;
    const t = tgt;
    if (!isString(s.schema) || !isString(s.version) || !isString(s.entity))
        return false;
    if (!isString(t.schema) || !isString(t.entity))
        return false;
    if (!isString(v.profileDigest))
        return false;
    return v.profileDigest === fachprofilMappingDigestV1(value);
}
/**
 * The one concrete M0 profile, frozen: the reused erp-read INVOICE fact
 * (sales-side BI reader) bound to the reused ERV INVOICE reference body
 * (purchase-side reconciliation core).
 *
 * Closed identities: invoiceId -> referenceId, totalMinor -> matchAmountMinor
 * (EUR integer minor only). The counterparty identity is NOT mapped: the
 * erp-read source exposes a sales-side customer, while the ERV target needs a
 * purchase-side supplier. Mapping customerId -> supplierId would be a word-level
 * conflation the profile refuses to declare. quantity is likewise unavailable.
 * Hence the amount sub-use is usable but the full reference body is not, until
 * supplierId and quantity come from a real purchase source: LOSSY_REQUIRES_DECISION.
 */
const ERP_READ_INVOICE_TO_ERV_INVOICE_CONTENT = {
    schemaVersion: FACHPROFIL_MAPPING_SCHEMA_V1,
    profileId: "fachprofil:erp-read-invoice-to-erv-invoice/v1",
    purpose: "Bind the reused erp-read INVOICE fact (source) to the reused ERV INVOICE " +
        "reference body (target) for the M1 invoice-reconciliation amount sub-use.",
    nonScope: "No real-integration claim; no runtime data-access right; no counterparty or " +
        "quantity reconstruction. Sales-side customer is never treated as purchase-side supplier.",
    source: { schema: "chimpmaera.connector/erp-read/v1", version: "1.0.0", entity: "invoices" },
    target: { schema: "chimpmaera.incoming-invoice/erv-core/v1", entity: "reference-body:INVOICE" },
    fieldMaps: [
        { sourceField: "invoiceId", targetField: "referenceId", identity: "INVOICE_IDENTITY", transform: "IDENTITY" },
        { sourceField: "totalMinor", targetField: "matchAmountMinor", identity: "INVOICE_AMOUNT_GROSS_EUR_MINOR", transform: "CURRENCY_EUR_MINOR" },
    ],
    declaredLosses: [
        {
            targetField: "supplierId",
            reasonCode: "COUNTERPARTY_IDENTITY_UNAVAILABLE",
            detail: "Source is sales-side (customer); target is purchase-side (supplier). The " +
                "purchase counterparty identity is not present in this source and is not " +
                "reconstructed by mapping.",
        },
        {
            targetField: "quantity",
            reasonCode: "QUANTITY_UNAVAILABLE",
            detail: "The erp-read invoice fact carries only the total amount, no line quantity; " +
                "quantity is not reconstructable from this source.",
        },
    ],
    compatibility: "LOSSY_REQUIRES_DECISION",
    contractOnly: true,
};
export const ERP_READ_INVOICE_TO_ERV_INVOICE_V1 = {
    ...ERP_READ_INVOICE_TO_ERV_INVOICE_CONTENT,
    profileDigest: fachprofilMappingDigestV1(ERP_READ_INVOICE_TO_ERV_INVOICE_CONTENT),
};
/**
 * The exact approved semantic identity of the single supported mapping
 * (review finding F3): the frozen profileId, the approved source/target
 * contract pair with versions, the exact fieldMaps, the exact declaredLosses
 * and the exact compatibility verdict. A self-consistent digest (verify passes)
 * is NOT an approved semantic mapping — only this exact identity may execute
 * the frozen field mapping. A caller-rehashed profile with a different
 * source, compatibility or emptied fieldMaps/losses must not silently run the
 * frozen mapping while suppressing its declared losses.
 */
export const FROZEN_FACHPROFIL_IDENTITY_V1 = {
    profileId: ERP_READ_INVOICE_TO_ERV_INVOICE_CONTENT.profileId,
    source: ERP_READ_INVOICE_TO_ERV_INVOICE_CONTENT.source,
    target: ERP_READ_INVOICE_TO_ERV_INVOICE_CONTENT.target,
    fieldMaps: ERP_READ_INVOICE_TO_ERV_INVOICE_CONTENT.fieldMaps,
    declaredLosses: ERP_READ_INVOICE_TO_ERV_INVOICE_CONTENT.declaredLosses,
    compatibility: ERP_READ_INVOICE_TO_ERV_INVOICE_CONTENT.compatibility,
};
/** Canonical digest of the frozen semantic identity (exact content pin). */
export const FROZEN_FACHPROFIL_IDENTITY_DIGEST_V1 = sha(FROZEN_FACHPROFIL_IDENTITY_V1);
/**
 * Closed check that a structurally-valid profile IS the frozen M0 profile by
 * exact semantic identity (F3). Structure (verifyFachprofilMappingV1) and
 * identity (this) are separated: a rehashed clone passes the structural check
 * but fails the identity check.
 */
export function isFrozenFachprofilMappingV1(value) {
    if (!verifyFachprofilMappingV1(value))
        return false;
    const profile = value;
    const identity = {
        profileId: profile.profileId,
        source: profile.source,
        target: profile.target,
        fieldMaps: profile.fieldMaps,
        declaredLosses: profile.declaredLosses,
        compatibility: profile.compatibility,
    };
    return sha(identity) === FROZEN_FACHPROFIL_IDENTITY_DIGEST_V1;
}
/**
 * Minimal executable check: apply the closed profile to a REAL erp-read invoice
 * fact (the shape of `ErpInvoiceV1`). Deterministic, local, no authority granted.
 */
export function applyFachprofilToErpReadInvoiceV1(fact, profile) {
    if (profile.profileDigest !== fachprofilMappingDigestV1(profile)) {
        return {
            outcome: "DENIED",
            code: "PROFILE_DIGEST_MISMATCH",
            detail: "Profile digest does not match its closed content; the profile is not the frozen M0 profile.",
        };
    }
    if (!isFrozenFachprofilMappingV1(profile)) {
        return {
            outcome: "DENIED",
            code: "PROFILE_IDENTITY_NOT_FROZEN",
            detail: "The profile is self-consistent but is not the approved frozen M0 semantic identity (profileId/source/target/fieldMaps/declaredLosses/compatibility); a caller-rehashed arbitrary profile must not execute the frozen mapping.",
        };
    }
    if (typeof fact !== "object" || fact === null) {
        return { outcome: "DENIED", code: "FIELD_MISSING", detail: "Fact is not an object." };
    }
    const f = fact;
    const invoiceId = f.invoiceId;
    if (typeof invoiceId !== "string" || invoiceId.length === 0) {
        return { outcome: "DENIED", code: "FIELD_MISSING", detail: "invoiceId is missing or not a string." };
    }
    const currency = f.currency;
    if (currency !== "EUR") {
        return {
            outcome: "DENIED",
            code: "CURRENCY_NOT_EUR",
            detail: `currency ${String(currency)} is not the closed EUR minor identity; no implicit conversion.`,
        };
    }
    const totalMinor = f.totalMinor;
    if (typeof totalMinor !== "number" || !Number.isInteger(totalMinor) || totalMinor < 0) {
        return {
            outcome: "DENIED",
            code: "AMOUNT_NOT_MINOR",
            detail: `totalMinor ${String(totalMinor)} is not a non-negative integer minor amount.`,
        };
    }
    const reference = {
        referenceKind: "INVOICE",
        referenceId: invoiceId,
        matchAmountMinor: totalMinor,
        supplierId: null,
        quantity: null,
        declaredLossReasonCodes: profile.declaredLosses.map((l) => l.reasonCode),
    };
    return { outcome: "MAPPED", reference };
}

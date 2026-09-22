import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { rechnungsabgleichFallZusammensetzenV1, RECHNUNGSABGLEICH_MATCHING_MODE_V1, RECHNUNGSABGLEICH_MATCHING_MODE_VERSION_V1, } from "./rechnungsabgleich-v1.js";
import { mengenzustandV1, } from "./beschaffung-wareneingang-v1.js";
import { createErpReadAdapterV1, } from "./erp-read-connector.js";
import { evaluateErvMatchingCaseV1, referenceContentSha256V1, } from "./incoming-invoice-erv.js";
/**
 * M1 slice 4 (Rechnungsabgleich-DECISIVE match) — closes the functional gap the
 * F1 correction left explicit, then corrected at the independent acceptance
 * review (PROC434 R1-R3):
 *
 * R1 (quantity/identity reconciliation): the decisive match is no longer a
 * quantity-blind amount comparison. It reconciles the BOUND order position
 * (ordered quantity, closed unit/currency/identity), the ACCEPTED goods
 * receipt (the real receipt-entrypoint readback) and the ACTUAL invoice line
 * (the sealed purchase-side source's own quantity) at the procurement level:
 *   - over-invoicing (invoiced > ordered or > accepted) is DENIED
 *     (MATCH_INVOICE_LINE_OVER_INVOICED); it can never read as a match;
 *   - a legitimate PARTIAL invoice (0 < invoiced < ordered, full receipt) is
 *     an explicit UNRESOLVED_PARTIAL_INVOICE with the REMAINING quantity
 *     stated — never a MATCHED decision and never a silent claim shrink;
 *   - an explicit PO-identity mapping (po-identity-mapping source) binds the
 *     local draft's supplier/article/order/position identities to the closed
 *     PO evidence, instead of attaching an unrelated amount reference.
 * The reused ERV amount evaluator (evaluateErvMatchingCaseV1) stays the
 * amount authority; it is not a claim that it performs procurement quantity
 * semantics. The positive fixture is coherent across all three
 * representations (ordered 100 / received 100 / invoiced 100, 2400 EUR
 * minor).
 *
 * R2 (source authenticity): the admitted synthetic invoice/valuation sources
 * are bound to an INDEPENDENTLY RETAINED code-owned approved-source manifest
 * (cm.proc434/procurement-434-approved-sources/v1) that records each source's
 * retained evidence identity (locator/generator/attester) and content seal.
 * A caller's content+self-hash is NOT source authority: a same-ID source
 * re-seal (changed quantity, recomputed digest), a metadata swap (changed
 * locator/generator/attester without rehash) and any content with no retained
 * entry are DENIED (MATCH_INVOICE_LINE_SOURCE_NOT_ADMITTED /
 * MATCH_RECEIPT_VALUATION_SOURCE_NOT_ADMITTED). The loaded AP-04 pack is
 * verified against its frozen identity (byte digest at the path, canonical
 * content digest here, tolerance-policy bytes included) BEFORE evaluation: a
 * STRICT_ZERO tolerance mutation under the same variant name/version is
 * DENIED (MATCH_AP04_PACK_NOT_FROZEN), and the derived ERV evidence preserves
 * the ACTUAL source locator/generator (no substituted fixed locator). The
 * actual provenance reflects the checked bytes.
 *
 * The F1 composition (rechnungsabgleich-v1.ts, byte-identical) runs as the
 * PRECONDITION: every F1 negative gate (owned reader-to-composition
 * boundary, caller-resealed source binding, closed units/currency,
 * over-receipt, partial receipt, no receipt, absent/tampered valuation,
 * unknown/PO supplier, separate-reference rule, source binding, stale
 * window, non-frozen tolerance) is preserved EXACTLY; a DENIED/UNRESOLVED
 * precondition is propagated unchanged.
 *
 * WHAT THIS MODULE IS NOT (closed non-claims, no manufactured evidence):
 *   - It does NOT copy the invoice supplier or line quantity from the PO or
 *     the goods receipt; they come ONLY from the sealed invoice-line source,
 *     which is admitted by the retained manifest and cross-checked (not
 *     word-mapped) against the source-bound reader fact and the closed
 *     PO/supplier identity.
 *   - It does NOT take the invoice AMOUNT from the invoice-line source; the
 *     amount stays the real erp-read reader fact (the F1 amount sub-use), so
 *     the source cannot re-label the amount.
 *   - It does NOT run the decisive match while the F1 precondition is
 *     DENIED/UNRESOLVED; a recomputed SELF digest on the invoice-line source
 *     is NOT an authentication grant; the erp-read source is LOCAL_SYNTHETIC
 *     and the invoice-line source is LOCAL_SYNTHETIC_FIXTURE — no production,
 *     booking or real-integration claim. The ERV core grants no booking
 *     authority (READ_SYNTHETIC / WRITE_LOCAL_PROOF only).
 */
export const RECHNUNGSABGLEICH_MATCH_SCHEMA_V1 = "cm.fachprofil/rechnungsabgleich-match/v1";
/** Closed schema of the sealed purchase-side invoice-line source. */
export const INVOICE_LINE_SCHEMA_V1 = "cm.fachprofil/rechnungszeile/v1";
/** Closed schema of the explicit PO-identity mapping source. */
export const PO_IDENTITY_MAPPING_SCHEMA_V1 = "cm.proc434/po-identity-mapping/v1";
/** Closed schema of the code-owned approved-source manifest. */
export const PROCUREMENT434_APPROVED_SOURCES_SCHEMA_V1 = "cm.proc434/procurement-434-approved-sources/v1";
/** The decisive matching mode this composition ASSEMBLES and RUNS. */
export const RECHNUNGSABGLEICH_DECISIVE_MODE_V1 = RECHNUNGSABGLEICH_MATCHING_MODE_V1;
/** The frozen canonical identity of the loaded AP-04 pack (all content
 * bytes, tolerance-policy bytes included). A mutation (e.g.
 * STRICT_ZERO_V1.absoluteToleranceMinor 0 -> 50) changes this digest and is
 * denied before any evaluation. */
export const AP04_ERV_CASE_PACK_CANONICAL_SHA256_V1 = "899d8dfc44be526011c35ad5aba4c2cb89bca433f1520e61fe05268d4816ad20";
/** The code-owned EXPECTED canonical digest of the approved-source manifest
 * (cm.proc434/procurement-434-approved-sources/v1) as RETAINED in the
 * repository. The entire manifest content (ap04Pack identity + every
 * source identity/content entry, byte-for-byte) must close to this
 * independently retained identity: a caller-supplied manifest whose content
 * differs — replaced entries, added entries, a rehashed same-ID source
 * content, or a removed nonclaim — changes the canonical digest and is
 * rejected (MATCH_APPROVED_SOURCES_NOT_CODE_OWNED) before any evaluation.
 * The manifest is imported exclusively through this package-owned boundary;
 * the caller may not substitute its own copy from the --root. */
export const PROCUREMENT434_APPROVED_SOURCES_CANONICAL_SHA256_V1 = "37e896ea344ac940d84c7ac57d8144a5f6219a886c6ebb87f2cf36178495d82f";
/** The code-owned approved-source manifest locator (owned source boundary). */
export const PROCUREMENT434_APPROVED_SOURCES_LOCATOR_V1 = "tests/fixtures/procurement-434/approved-sources-v1.json";
const sha = (value) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isSha256 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
/** Independent seal of the invoice line over its amount-carrying identity core. */
function invoiceLineCore(value) {
    return {
        invoiceId: value.invoiceId,
        supplierId: value.supplierId,
        bestellungId: value.bestellungId,
        positionId: value.positionId,
        einheit: value.einheit,
        waehrung: value.waehrung,
        menge: value.menge,
        amountMinor: value.amountMinor,
    };
}
/** Independent seal of the PO-identity mapping over its identity core. */
function poMappingCore(value) {
    return {
        poReferenceId: value.poReferenceId,
        supplierClosedIdentity: value.supplierClosedIdentity,
        localSupplierId: value.localSupplierId,
        localBestellungId: value.localBestellungId,
        localPositionId: value.localPositionId,
        localArtikelId: value.localArtikelId,
    };
}
/**
 * R2: the loaded AP-04 pack is verified against its INDEPENDENTLY RETAINED
 * frozen identity BEFORE evaluation: the canonical content digest (all
 * content bytes, tolerance-policy bytes included — a STRICT_ZERO mutation
 * under the same variant name/version fails here) must equal the frozen
 * canonical identity, and the manifest's retained byte digest must equal the
 * frozen byte identity. The ACTUAL provenance (the manifest's checked values)
 * is returned so the result reflects the checked bytes, not a substituted
 * constant. A mutated pack is DENIED (MATCH_AP04_PACK_NOT_FROZEN).
 */
function verifyAp04PackIdentityV1(pack, approvedSources) {
    if (!isObject(approvedSources) || approvedSources.schemaVersion !== PROCUREMENT434_APPROVED_SOURCES_SCHEMA_V1
        || !isObject(approvedSources.ap04Pack)
        || !isSha256(approvedSources.ap04Pack.sha256)
        || !isSha256(approvedSources.ap04Pack.canonicalSha256)
        || approvedSources.ap04Pack.sha256 !== "136bbdfcb61bf48ab0043d828dbf797e9b9156f58d284cc7f9b921da59040845"
        || approvedSources.ap04Pack.canonicalSha256 !== AP04_ERV_CASE_PACK_CANONICAL_SHA256_V1) {
        return null;
    }
    if (sha(pack) !== AP04_ERV_CASE_PACK_CANONICAL_SHA256_V1)
        return null;
    return { sha256: approvedSources.ap04Pack.sha256, canonicalSha256: approvedSources.ap04Pack.canonicalSha256 };
}
/**
 * R2: the retained approved-source entry for a source (exact evidence
 * identity + content seal). A caller's content+self-hash is NOT source
 * authority: a same-ID re-seal (changed quantity, recomputed digest), a
 * metadata swap (changed locator/generator/attester without rehash) and any
 * unlisted content yield no entry.
 */
function approvedSourceEntry(approvedSources, locator, generator, attestedBy, contentSha256) {
    if (!isObject(approvedSources) || !Array.isArray(approvedSources.sources))
        return null;
    const candidates = approvedSources.sources;
    for (const candidate of candidates) {
        if (!isObject(candidate))
            continue;
        if (candidate.locator !== locator
            || candidate.generator !== generator
            || candidate.attestedBy !== attestedBy
            || !isSha256(candidate.contentSha256)
            || candidate.contentSha256 !== contentSha256)
            continue;
        return {
            locator: candidate.locator,
            generator: candidate.generator,
            attestedBy: candidate.attestedBy,
            contentSha256: candidate.contentSha256,
        };
    }
    return null;
}
/** The real erp-read reader fact totalMinor for the bound invoice (source-bound
 * re-read through the retained reader; the authoritative invoice amount). */
function readerFactTotalMinorV1(source, contract, now, invoiceId) {
    const adapter = createErpReadAdapterV1({ contract, source, enabled: true, now });
    const res = adapter({
        operation: "LIST_INVOICES",
        tenantId: contract.tenantId,
        principalId: contract.identity.principalId,
        scopes: contract.identity.scopes,
        credentialPresent: true,
        fields: contract.fields.invoices,
        pageSize: contract.policy.maxPageSize,
    });
    if (res.outcome !== "READ")
        return null;
    const fact = res.records.find((f) => f.invoiceId === invoiceId);
    if (fact === undefined)
        return null;
    const total = fact.totalMinor;
    return typeof total === "number" && Number.isSafeInteger(total) ? total : null;
}
/**
 * Compose the decisive three-way purchase match and RUN the reused ERV core.
 *
 * Order of closed checks (each fail-closed, before the next):
 *   (a) the loaded AP-04 pack is verified against its retained frozen identity
 *       (R2) — a tolerance mutation under the same variant name/version fails
 *       here (MATCH_AP04_PACK_NOT_FROZEN);
 *   (b) the F1 composition precondition (all F1 negative gates preserved) —
 *       a DENIED/UNRESOLVED precondition propagates unchanged;
 *   (c) the sealed invoice-line source: closed shape, self-seal, and ADMISSION
 *       by the retained approved-source manifest (R2);
 *   (d) the explicit PO-identity mapping (R1): closed shape, self-seal,
 *       admission (R2), and the closed identity links (draft supplier/order/
 *       position/article -> PO reference + supplier-closed identity);
 *   (e) the receipt valuation is admitted by the retained manifest (R2);
 *   (f) the invoice line cross-checks: invoice/order/position close to the
 *       binding, supplier closes to the PO/supplier identity, unit/currency
 *       close to the bound position, the amount equals the real erp-read
 *       reader fact (the authoritative amount);
 *   (g) the procurement-level QUANTITY reconciliation (R1): over-invoicing
 *       (invoiced > ordered or > accepted) is DENIED; a legitimate partial
 *       invoice (0 < invoiced < ordered, full receipt) is an explicit
 *       UNRESOLVED_PARTIAL_INVOICE with the remaining quantity;
 *   (h) the decisive ERV case is ASSEMBLED from source-bound, independently
 *       sealed references (derived evidence preserves the ACTUAL source
 *       locator/generator, R2) and RUN through the reused ERV core.
 */
export function rechnungsabgleichMatchZusammensetzenV1(input, pack) {
    if (!isObject(input)) {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_NOT_CLOSED", detail: "Input is not an object." };
    }
    // ---- R2: the loaded AP-04 pack must close to its retained frozen identity. ----
    const approvedRaw = input.approvedSources;
    if (!isObject(approvedRaw)) {
        return { outcome: "DENIED", code: "MATCH_APPROVED_SOURCES_NOT_CLOSED", detail: "approvedSources must be the code-owned approved-source manifest (cm.proc434/procurement-434-approved-sources/v1); without the retained source boundary the admitted synthetic invoice/valuation sources cannot authenticate." };
    }
    const approved = approvedRaw;
    // ---- R2 (source-authority boundary): the ENTIRE approved-source manifest is
    // bound to a code-owned expected canonical digest. The manifest is imported
    // exclusively through this package-owned boundary (the expected digest is a
    // retained constant in the contracts source, independently of the fixture
    // directory): a caller may not supply its own copy of the manifest — not
    // from a copied --root, not by replacing, adding or rehashing entries, not by
    // a rehashed same-ID source content. Any such substitution changes the
    // canonical digest of the whole manifest and is rejected here, BEFORE any
    // evaluation. No new authentication platform is introduced: this is the
    // retained identity/content binding the manifest's own nonclaims declare.
    if (sha(approvedRaw) !== PROCUREMENT434_APPROVED_SOURCES_CANONICAL_SHA256_V1) {
        return { outcome: "DENIED", code: "MATCH_APPROVED_SOURCES_NOT_CODE_OWNED", detail: "the approved-source manifest does not close to the code-owned expected canonical digest; the entire manifest (ap04Pack identity and every source identity/content entry) is caller-replaced, added, removed or rehashed — a caller-supplied manifest is not source authority and the admitted synthetic sources cannot authenticate." };
    }
    const ap04Pack = verifyAp04PackIdentityV1(pack, approved);
    if (ap04Pack === null) {
        return { outcome: "DENIED", code: "MATCH_AP04_PACK_NOT_FROZEN", detail: "the loaded AP-04 pack does not close to its retained frozen identity (canonical content digest and/or byte digest differ — e.g. a STRICT_ZERO tolerance-policy mutation under the same variant name/version); the tolerance policy bytes are part of the frozen pack, so the evaluation is refused before any decision." };
    }
    // ---- Precondition: the F1 composition must reach the (narrowed) fall. ----
    // This preserves every F1 negative gate EXACTLY (owned reader-to-composition
    // boundary, foreign-ledger isolation, closed units/currency, over-receipt,
    // partial receipt, no receipt, absent/tampered valuation, unknown/PO
    // supplier, separate-reference rule, source binding, stale window). A
    // DENIED/UNRESOLVED precondition is propagated unchanged: no decisive match
    // is assembled while any F1 gate fails.
    const fall = rechnungsabgleichFallZusammensetzenV1(input, pack);
    if (fall.outcome !== "RECHNUNGSABGLEICH_FALL") {
        return { outcome: fall.outcome, code: fall.code, detail: fall.detail };
    }
    const binding = input.binding;
    const position = input.entwurf.positionen.find((p) => p.positionId === binding.positionId);
    const bestellteMenge = typeof position?.bestellteMenge === "number" ? position.bestellteMenge : NaN;
    const positionArtikelId = typeof position?.artikelId === "string" ? position.artikelId : "";
    const positionEinheit = typeof position?.einheit === "string" ? position.einheit : "";
    const positionWaehrung = typeof position?.waehrung === "string" ? position.waehrung : "";
    const poSupplier = input.poReference.body.supplierId;
    // ---- R1 (frozen PO SOURCE quantity enforcement): the explicit PO-identity
    // mapping binds the local draft to the closed PO evidence (identities only).
    // An identity-only mapping does NOT reconcile a quantity discrepancy: the
    // bound position's ordered quantity must EQUAL the frozen PO reference's own
    // source quantity. A draft quantity that disagrees with the source (under-
    // or over-ordered) is DENIED (MATCH_DRAFT_PO_QUANTITY_MISMATCH) before any
    // quantity reconciliation — the source quantity is the comparison authority,
    // never a word-mapped or silently irrelevant value, and no unit conversion
    // is invented (the closed unit is part of the bound position).
    const poSourceQuantity = input.poReference.body.quantity;
    if (typeof poSourceQuantity !== "number" || !Number.isSafeInteger(poSourceQuantity) || poSourceQuantity < 1) {
        return { outcome: "DENIED", code: "MATCH_PRECONDITION_NOT_CLOSED", detail: `the frozen PO reference ${binding.poReferenceId} does not carry a closed positive source quantity (${String(poSourceQuantity)}); the quantity comparison authority is unresolved.` };
    }
    if (bestellteMenge !== poSourceQuantity) {
        return { outcome: "DENIED", code: "MATCH_DRAFT_PO_QUANTITY_MISMATCH", detail: `the bound position orders ${bestellteMenge} ${positionEinheit} but the frozen PO ${binding.poReferenceId} source quantity is ${poSourceQuantity} ${positionEinheit}; the explicit PO-identity mapping binds identities only and does NOT reconcile a quantity discrepancy — the source quantity is the comparison authority, so the draft/PO mismatch is denied (no implicit conversion, no silent irrelevance).` };
    }
    // ---- R1: the explicit PO-identity mapping (draft -> PO evidence). ----
    const mappingRaw = input.poIdentityMapping;
    if (!isObject(mappingRaw)) {
        return { outcome: "DENIED", code: "MATCH_PO_MAPPING_NOT_CLOSED", detail: "poIdentityMapping must be the explicit PO-identity mapping source (cm.proc434/po-identity-mapping/v1) binding the local draft's supplier/article/order/position identities to the closed PO evidence; an unrelated amount reference is not an identity link." };
    }
    const mapping = mappingRaw;
    if (mapping.schemaVersion !== PO_IDENTITY_MAPPING_SCHEMA_V1
        || typeof mapping.poReferenceId !== "string" || mapping.poReferenceId.length === 0
        || typeof mapping.supplierClosedIdentity !== "string" || mapping.supplierClosedIdentity.length === 0
        || typeof mapping.localSupplierId !== "string" || mapping.localSupplierId.length === 0
        || typeof mapping.localBestellungId !== "string" || mapping.localBestellungId.length === 0
        || typeof mapping.localPositionId !== "string" || mapping.localPositionId.length === 0
        || typeof mapping.localArtikelId !== "string" || mapping.localArtikelId.length === 0
        || !isSha256(mapping.contentSha256)
        || !isObject(mapping.evidence) || mapping.evidence.sourceKind !== "LOCAL_SYNTHETIC_FIXTURE") {
        return { outcome: "DENIED", code: "MATCH_PO_MAPPING_NOT_CLOSED", detail: "the PO-identity mapping is not a closed, content-sealed LOCAL_SYNTHETIC_FIXTURE with the closed identity core (poReferenceId, supplierClosedIdentity, localSupplierId, localBestellungId, localPositionId, localArtikelId)." };
    }
    if (mapping.contentSha256 !== sha(poMappingCore(mapping))) {
        return { outcome: "DENIED", code: "MATCH_PO_MAPPING_NOT_CLOSED", detail: "the PO-identity mapping's content seal does not close over its identity core; a tampered or re-sealed mapping is not source-bound." };
    }
    // R1: the mapping must bind the closed identities (draft -> PO evidence).
    if (mapping.poReferenceId !== binding.poReferenceId || mapping.supplierClosedIdentity !== poSupplier) {
        return { outcome: "DENIED", code: "MATCH_PO_MAPPING_IDENTITY_MISMATCH", detail: `the PO-identity mapping does not close to the bound PO reference ${binding.poReferenceId} / supplier-closed identity ${poSupplier}; the identity link between the draft and the PO evidence is unresolved, never word-mapped.` };
    }
    if (mapping.localBestellungId !== binding.bestellungId || mapping.localPositionId !== binding.positionId) {
        return { outcome: "DENIED", code: "MATCH_PO_MAPPING_IDENTITY_MISMATCH", detail: `the PO-identity mapping does not close to the bound local order ${binding.bestellungId} / position ${binding.positionId}; the draft identity is unresolved.` };
    }
    if (mapping.localSupplierId !== input.entwurf.lieferantId) {
        return { outcome: "DENIED", code: "MATCH_PO_MAPPING_IDENTITY_MISMATCH", detail: `the PO-identity mapping's local supplier ${mapping.localSupplierId} does not close to the Bestellentwurf's closed supplier ${input.entwurf.lieferantId}; the draft supplier identity is unresolved.` };
    }
    if (mapping.localArtikelId !== positionArtikelId) {
        return { outcome: "DENIED", code: "MATCH_PO_MAPPING_IDENTITY_MISMATCH", detail: `the PO-identity mapping's local article ${mapping.localArtikelId} does not close to the bound position's article ${positionArtikelId}; the draft article identity is unresolved.` };
    }
    // R2: the mapping is admitted by the retained approved-source manifest.
    if (approvedSourceEntry(approved, mapping.evidence.locator, mapping.evidence.generator, mapping.evidence.attestedBy, mapping.contentSha256) === null) {
        return { outcome: "DENIED", code: "MATCH_PO_MAPPING_SOURCE_NOT_ADMITTED", detail: `the PO-identity mapping (${mapping.evidence.locator}) is not admitted by the code-owned approved-source manifest (retained identity/content differ); a caller's content+self-hash is not source authority — a re-sealed or metadata-swapped mapping is not an approved source.` };
    }
    // ---- The sealed purchase-side invoice-line source (the supplied losses). ----
    const lineRaw = input.invoiceLine;
    if (!isObject(lineRaw)) {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_NOT_CLOSED", detail: "invoiceLine must be the sealed purchase-side invoice-line source (the supplied M0-declared invoice supplier + line quantity); without it the decisive purchase match is not available (the F1 residual, preserved)." };
    }
    const line = lineRaw;
    if (line.schemaVersion !== INVOICE_LINE_SCHEMA_V1
        || typeof line.invoiceId !== "string" || line.invoiceId.length === 0
        || typeof line.supplierId !== "string" || line.supplierId.length === 0
        || typeof line.bestellungId !== "string" || line.bestellungId.length === 0
        || typeof line.positionId !== "string" || line.positionId.length === 0
        || typeof line.einheit !== "string" || line.einheit.length === 0
        || typeof line.waehrung !== "string" || line.waehrung.length === 0
        || typeof line.menge !== "number" || !Number.isSafeInteger(line.menge)
        || typeof line.amountMinor !== "number" || !Number.isSafeInteger(line.amountMinor)
        || !isSha256(line.contentSha256)
        || !isObject(line.evidence) || line.evidence.sourceKind !== "LOCAL_SYNTHETIC_FIXTURE") {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_NOT_CLOSED", detail: "the invoice-line source is not a closed, content-sealed LOCAL_SYNTHETIC_FIXTURE with the closed identity/unit/currency/quantity/amount core." };
    }
    if (line.contentSha256 !== sha(invoiceLineCore(line))) {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_SEAL_BROKEN", detail: "the invoice-line source's content seal does not close over its amount-carrying identity core; a tampered or re-sealed line is not source-bound." };
    }
    // R2: the invoice line is admitted by the retained approved-source manifest.
    // A same-ID re-seal (changed quantity, recomputed digest) or a metadata swap
    // (changed locator/generator/attester without rehash) has no retained entry.
    if (approvedSourceEntry(approved, line.evidence.locator, line.evidence.generator, line.evidence.attestedBy, line.contentSha256) === null) {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_SOURCE_NOT_ADMITTED", detail: `the invoice-line source (${line.evidence.locator}) is not admitted by the code-owned approved-source manifest (retained identity/content differ); a caller's content+self-hash is not source authority — a same-ID re-seal, a metadata swap or unlisted content is not an approved source.` };
    }
    if (line.invoiceId !== binding.erpReadInvoiceId) {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_INVOICE_MISMATCH", detail: `the invoice line belongs to invoice ${line.invoiceId}, not the bound ${binding.erpReadInvoiceId}; the line cannot bind to an unknown invoice.` };
    }
    if (line.bestellungId !== binding.bestellungId) {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_ORDER_MISMATCH", detail: `the invoice line belongs to order ${line.bestellungId}, not the bound ${binding.bestellungId}; the line's closed ownership does not match.` };
    }
    if (line.positionId !== binding.positionId) {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_POSITION_MISMATCH", detail: `the invoice line belongs to position ${line.positionId}, not the bound ${binding.positionId}; an identical local positionId in another order is a different closed identity.` };
    }
    // The invoice's own supplier (its evidence, not a PO copy) must close to the
    // closed PO/supplier identity. A swapped source with a different supplier
    // (even with a valid self-digest) does NOT close here.
    if (line.supplierId !== poSupplier) {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_SUPPLIER_NOT_CLOSED", detail: `the invoice line's supplier ${line.supplierId} does not close to the PO/supplier closed identity ${poSupplier}; the supplier relation is unresolved, never word-mapped or reconstructed.` };
    }
    if (position === undefined || line.einheit !== positionEinheit) {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_UNIT_MISMATCH", detail: `the invoice line's unit ${String(line.einheit)} does not match the bound position's closed unit ${positionEinheit}; quantities are only comparable in the same closed unit.` };
    }
    if (line.waehrung !== positionWaehrung) {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_CURRENCY_MISMATCH", detail: `the invoice line's currency ${String(line.waehrung)} does not match the bound position's closed currency ${positionWaehrung}; the amount dimension is unresolved.` };
    }
    if (line.menge < 1) {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_MENGE_NOT_CLOSED", detail: `the invoice line's menge ${String(line.menge)} is not a closed positive quantity; the invoiced line quantity is not closed.` };
    }
    if (line.amountMinor < 0) {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_AMOUNT_NOT_CLOSED", detail: `the invoice line's amountMinor ${String(line.amountMinor)} is not a closed non-negative integer minor.` };
    }
    // The authoritative invoice amount is the REAL erp-read reader fact (source-
    // bound via the owned reader boundary), NOT the invoice-line source. The
    // invoice-line amount is a cross-check: it must equal the reader fact.
    const source = input.erpReadSource;
    const contract = input.erpReadContract;
    const now = typeof input.erpReadNow === "string" ? input.erpReadNow : "";
    const readerTotal = readerFactTotalMinorV1(source, contract, now, binding.erpReadInvoiceId);
    if (readerTotal === null || readerTotal !== fall.amountComparison.invoiceAmountMinor) {
        return { outcome: "DENIED", code: "MATCH_PRECONDITION_NOT_CLOSED", detail: "the real erp-read reader fact could not be re-established for the bound invoice; the authoritative invoice amount is not source-bound." };
    }
    if (line.amountMinor !== readerTotal) {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_AMOUNT_CONFLICTS_READER", detail: `the invoice line's amountMinor ${line.amountMinor} conflicts with the real erp-read reader fact's totalMinor ${readerTotal}; the invoice amount is not closed across its sources.` };
    }
    // ---- R1: the receipt valuation is admitted by the retained manifest. ----
    const valuation = input.receiptValuation;
    if (valuation === null || approvedSourceEntry(approved, valuation.evidence.locator, valuation.evidence.generator, valuation.evidence.attestedBy, valuation.contentSha256) === null) {
        return { outcome: "DENIED", code: "MATCH_RECEIPT_VALUATION_SOURCE_NOT_ADMITTED", detail: "the independently bound receipt valuation is not admitted by the code-owned approved-source manifest (retained identity/content differ); its amount cannot authenticate (a re-sealed or metadata-swapped valuation is not an approved source)." };
    }
    // ---- R1: the procurement-level QUANTITY reconciliation. ----
    const received = mengenzustandV1(input.entwurf, input.receiptLedger).angenommeneMenge;
    const invoicedMenge = line.menge;
    // Over-invoicing is never a match: it exceeds the ordered quantity and/or
    // the accepted receipt. (The F1 precondition already guarantees received <=
    // ordered and, on the full-receipt fall, received == ordered.)
    if (invoicedMenge > bestellteMenge || invoicedMenge > received) {
        return { outcome: "DENIED", code: "MATCH_INVOICE_LINE_OVER_INVOICED", detail: `the invoice line invoices ${invoicedMenge} ${positionEinheit} but the bound position ordered ${bestellteMenge} and the accepted receipt admitted ${received} ${positionEinheit}; over-invoicing is rejected (a matched decision is never issued beyond the ordered/accepted quantity).` };
    }
    // A legitimate partial invoice (0 < invoiced < ordered, full receipt) is an
    // explicit UNRESOLVED with the remaining quantity — never MATCHED, never a
    // silent claim shrink.
    if (received === bestellteMenge && invoicedMenge < bestellteMenge) {
        const remaining = bestellteMenge - invoicedMenge;
        return { outcome: "UNRESOLVED", code: "UNRESOLVED_PARTIAL_INVOICE", remainingMenge: remaining, detail: `the invoice line invoices ${invoicedMenge} of ${bestellteMenge} ${positionEinheit} (accepted receipt ${received}/${bestellteMenge} ${positionEinheit}); under the declared partial-invoice policy this is a legitimate partial invoice: the remaining ${remaining} ${positionEinheit} is outstanding, so the match is UNRESOLVED (not MATCHED) and no booking or acknowledgement is implied.` };
    }
    // ---- Assemble the decisive ERV case from source-bound, sealed references. ----
    // R2: the derived ERV evidence PRESERVES THE ACTUAL SOURCE locator/generator
    // (the admitted fixture's own identity) — no substituted fixed locator, so
    // the provenance reflects the checked bytes.
    const supplierRef = input.supplierReference;
    const poRef = input.poReference;
    const invoiceBody = { referenceKind: "INVOICE", referenceId: binding.erpReadInvoiceId, supplierId: line.supplierId, matchAmountMinor: readerTotal, quantity: invoicedMenge };
    const receiptBody = { referenceKind: "RECEIPT", referenceId: valuation.referenceId, supplierId: valuation.supplierId, matchAmountMinor: valuation.matchAmountMinor, quantity: received };
    const references = [
        supplierRef,
        poRef,
        { body: receiptBody, evidence: { sourceKind: "LOCAL_SYNTHETIC_FIXTURE", locator: valuation.evidence.locator, generator: valuation.evidence.generator, contentSha256: referenceContentSha256V1(receiptBody) } },
        { body: invoiceBody, evidence: { sourceKind: "LOCAL_SYNTHETIC_FIXTURE", locator: line.evidence.locator, generator: line.evidence.generator, contentSha256: referenceContentSha256V1(invoiceBody) } },
    ];
    const caseId = `proc434:${binding.bestellungId}:${binding.positionId}`;
    const erpCase = {
        caseId,
        matchingMode: { variantId: RECHNUNGSABGLEICH_DECISIVE_MODE_V1, version: RECHNUNGSABGLEICH_MATCHING_MODE_VERSION_V1 },
        tolerancePolicy: { variantId: input.tolerancePolicy.variantId, version: input.tolerancePolicy.version },
        requestedEffects: ["READ_SYNTHETIC", "WRITE_LOCAL_PROOF"],
        references,
    };
    const decision = evaluateErvMatchingCaseV1(erpCase, pack);
    const core = {
        schemaVersion: RECHNUNGSABGLEICH_MATCH_SCHEMA_V1,
        outcome: "RECHNUNGSABGLEICH_MATCH",
        mode: RECHNUNGSABGLEICH_DECISIVE_MODE_V1,
        decision,
        quantities: { bestellteMenge, mengenReceived: received, invoicedMenge, einheit: positionEinheit, waehrung: positionWaehrung },
        reconciliation: { invoicedMenge, remainingMenge: bestellteMenge - invoicedMenge, policy: invoicedMenge === bestellteMenge ? "FULL_INVOICE" : "PARTIAL_INVOICE" },
        invoiceLine: { supplierId: line.supplierId, menge: invoicedMenge, einheit: line.einheit, amountMinor: line.amountMinor, contentSha256: line.contentSha256, locator: line.evidence.locator, generator: line.evidence.generator },
        ap04Pack,
        fallDigest: fall.fallDigest,
        source: { sourceDatasetId: fall.source.sourceDatasetId, sourceDigest: fall.source.sourceDigest, readbackDigest: fall.source.readbackDigest },
    };
    return { ...core, matchDigest: sha(core) };
}
/** Verify a decisive-match result's closed digest against its content. */
export function verifyRechnungsabgleichMatchDigestV1(value) {
    if (!isObject(value) || typeof value.matchDigest !== "string")
        return false;
    const core = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "matchDigest"));
    return value.matchDigest === sha(core);
}

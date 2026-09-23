import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { applyFachprofilToErpReadInvoiceV1, ERP_READ_INVOICE_TO_ERV_INVOICE_V1, } from "./fachprofil-mapping-v1.js";
import { mengenzustandV1, WARENEINGANG_LEDGER_SCHEMA_V1, } from "./beschaffung-wareneingang-v1.js";
import { createErpReadAdapterV1, ERP_READ_CONNECTOR_SCHEMA_V1, } from "./erp-read-connector.js";
/**
 * M1 slice 3 (Rechnungsabgleich-Komposition) — the real procurement ->
 * receipt -> invoice composition required by the rulewerk M1 user case and
 * review finding F1, corrected after the parent intermediate F1 readback at
 * 5d36145 (be6ae7c) AND after the parent's final acceptance at head 4281664
 * (two residual defects, both reproduced RED and fixed here):
 *
 *   (1) MISSING INVOICE SUPPLIER/QUANTITY MUST NOT ESTABLISH A PURCHASE MATCH.
 *       The frozen M0 profile declares the erp-read source's supplierId and
 *       quantity as losses (COUNTERPARTY_IDENTITY_UNAVAILABLE /
 *       QUANTITY_UNAVAILABLE). A PO supplier identity and a quantity zero
 *       sentinel are NOT invoice evidence. The decisive three-way purchase
 *       match (THREE_WAY_INVOICE_PO_RECEIPT_V1) is therefore NEVER assembled
 *       and NEVER run while the invoice-side evidence is incomplete — not
 *       even on a full receipt with an independent sealed valuation. The
 *       claim is narrowed to what the caller-supplied synthetic evidence
 *       actually supports: an explicit, NON-DECISIVE INVOICE-vs-PO amount
 *       comparison (INVOICE_PO_AMOUNT_ONLY_V1) carried as a documented,
 *       self-digesting fall with decision=null and
 *       purchaseMatch.available=false.
 *   (2) A CALLER REHASH DOES NOT AUTHENTICATE THE SOURCE. The previous
 *       attestation was self-consistent (factsDigest over the caller's own
 *       facts): a caller could alter a fact (totalMinor 2400 -> 2500),
 *       rehash factsDigest and keep the sourceDigest, and the composition
 *       accepted the altered fact with verified citations. The module now
 *       implements the OWNED READER-TO-COMPOSITION BOUNDARY: the caller
 *       re-submits the SEALED supported export (self-sealed by its closed
 *       lineage.sourceDigest), the verified reader connector contract and
 *       the read timestamp; the composition RUNS THE RETAINED READER
 *       (createErpReadAdapterV1) over the sealed source ITSELF and requires
 *       the caller-supplied reader READ result to equal the owned read
 *       EXACTLY (records + metadata + readbackDigest), and the attested
 *       factsDigest to bind the EXACT owned records. A re-sealed altered
 *       fact cannot match the owned read -> DENIED
 *       FALL_READER_SOURCE_BINDING_NOT_CLOSED. Self-consistent caller
 *       digests are never accepted as source authentication.
 *
 * WHAT THIS MODULE IS: one callable composition that accepts
 *   - the SEALED supported export the reader read (self-sealed; the
 *     authentication basis), the verified reader connector contract, and the
 *     read timestamp — the composition re-reads through the retained reader;
 *   - the reader's closed READ result (records + metadata + readbackDigest)
 *     and the reader's LOCAL_SYNTHETIC lineage attestation, both of which
 *     must bind to the owned read;
 *   - the frozen M0 Zuordnungsprofil (binds the fact to the ERV INVOICE
 *     amount sub-use and DECLARES supplierId/quantity as losses);
 *   - an EXPLICIT purchase-side relation binding (invoiceId -> PO reference
 *     + Bestellposition) with closed role/ownership;
 *   - the closed Bestellentwurf position (ordered quantity/unit/currency);
 *   - a REAL receipt (Wareneingang) ledger produced by the receipt entrypoint
 *     (wareneingangErfassenV1), whose received quantity is the readback from
 *     mengenzustandV1 (the real receipt entrypoint);
 *   - an INDEPENDENTLY BOUND receipt valuation (a separately-attested
 *     warehouse goods-receipt reference, sealed by its own content digest,
 *     DISTINCT from the PO reference);
 * and returns the closed terminal:
 *   - DENIED (closed code) for every unclosed or unbound input, including
 *     the owned source-binding failure;
 *   - UNRESOLVED (preserved codes) for the unclosed receipt dimension:
 *     UNRESOLVED_NO_RECEIPT / UNRESOLVED_RECEIPT_VALUATION_ABSENT /
 *     UNRESOLVED_PARTIAL_RECEIPT (the corrected partial-receipt behavior is
 *     preserved exactly);
 *   - RECHNUNGSABGLEICH_FALL (the narrowed claim): the explicit
 *     INVOICE-vs-PO amount comparison (decision=null — the real matcher is
 *     NOT run; purchaseMatch.available=false — the decisive three-way
 *     purchase match is unavailable on this source; the M0 declared losses
 *     are carried explicitly; the invoiced line quantity stays null).
 *
 * WHAT THIS MODULE IS NOT (closed non-claims / no manufactured evidence):
 *   - It does NOT run the decisive purchase match on incomplete invoice-side
 *     evidence and does NOT present a PO supplier identity or a quantity zero
 *     sentinel as invoice evidence.
 *   - It does NOT copy the receipt quantity into any invoice evidence; the
 *     public invoicedMenge stays null (UNRESOLVED) — the source genuinely
 *     cannot provide an independent invoiced line quantity.
 *   - It does NOT copy the PO amount into the RECEIPT reference; the receipt
 *     amount is an independently bound valuation with its own seal and
 *     identity, distinct from the PO.
 *   - It does NOT accept caller-rehashed facts as source-bound: the reader
 *     chain is re-established by the module over the sealed source.
 *   - The erp-read customerId is NEVER mapped to the purchase-side
 *     supplierId (the M0 profile declares that loss); the purchase binding
 *     comes ONLY from the explicit relation binding plus the PO/receipt
 *     closed identities.
 *   - The erp-read source is a local synthetic export (LOCAL_SYNTHETIC);
 *     this is no production, booking or real-integration claim, and the
 *     narrowed comparison is a synthetic amount comparison only — never a
 *     purchase match, never an independent-authentication claim from a
 *     self-consistent digest.
 */
export const RECHNUNGSABGLEICH_FALL_SCHEMA_V1 = "cm.fachprofil/rechnungsabgleich-fall/v1";
/**
 * The decisive purchase matching mode this composition SERVES when the
 * invoice-side evidence is complete. On the frozen M0 erp-read source it is
 * NOT available (declared losses), so it is never assembled or run — this
 * constant names the capability that is missing, it is not a claim that it
 * was executed.
 */
export const RECHNUNGSABGLEICH_MATCHING_MODE_V1 = "THREE_WAY_INVOICE_PO_RECEIPT_V1";
export const RECHNUNGSABGLEICH_MATCHING_MODE_VERSION_V1 = "1.0.0";
/** The narrowed claim this source evidence supports: amount comparison only. */
export const RECHNUNGSABGLEICH_COMPARISON_MODE_V1 = "INVOICE_PO_AMOUNT_ONLY_V1";
/** Closed schema of the independently-attested warehouse goods-receipt valuation. */
export const RECEIPT_VALUATION_SCHEMA_V1 = "cm.fachprofil/wareneingang-beleg/v1";
/** The explicit missing-capability code for the decisive purchase match. */
export const UNRESOLVED_INVOICE_EVIDENCE_INCOMPLETE_V1 = "UNRESOLVED_INVOICE_EVIDENCE_INCOMPLETE";
const sha = (value) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function exactKeys(value, keys) {
    if (!isObject(value))
        return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
const isSha256 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
/** Closed digest over the EXACT erp-read facts (records) an attestation covers. */
export function readerFactsDigestV1(facts) {
    return createHash("sha256").update(canonicalJson(facts), "utf8").digest("hex");
}
/** Independent seal of the receipt valuation over its amount-carrying core. */
function receiptValuationCore(value) {
    return {
        referenceId: value.referenceId,
        referenceKind: value.referenceKind,
        belegId: value.belegId,
        bestellungId: value.bestellungId,
        positionId: value.positionId,
        supplierId: value.supplierId,
        einheit: value.einheit,
        waehrung: value.waehrung,
        matchAmountMinor: value.matchAmountMinor,
    };
}
/**
 * Compose the real purchase-side invoice/PO/receipt evidence and return the
 * closed terminal. The owned reader-to-composition boundary (sealed source +
 * contract + the module's own re-read through the retained reader) is checked
 * first: a caller-resealed or altered fact is DENIED there. The decisive
 * purchase match is never run while the invoice-side evidence is incomplete
 * (the M0 declared losses): the result is the explicit narrowed amount
 * comparison with decision=null and purchaseMatch.available=false.
 */
export function rechnungsabgleichFallZusammensetzenV1(input, pack, profile = ERP_READ_INVOICE_TO_ERV_INVOICE_V1) {
    if (!isObject(input))
        return { outcome: "DENIED", code: "FALL_NOT_OBJECT", detail: "Input is not an object." };
    // ---- Owned reader-to-composition boundary ----
    const source = input.erpReadSource;
    if (!isObject(source) || !Array.isArray(source.batches) || !isObject(source.lineage)) {
        return { outcome: "DENIED", code: "FALL_ERP_READ_SOURCE_NOT_CLOSED", detail: "erpReadSource must be the sealed supported export (lineage/batches) the reader read; the sealed source is the authentication basis for the reader chain." };
    }
    const contract = input.erpReadContract;
    if (!isObject(contract) || contract.schemaVersion !== ERP_READ_CONNECTOR_SCHEMA_V1
        || typeof contract.tenantId !== "string" || contract.tenantId.length === 0
        || !isObject(contract.identity) || !isObject(contract.policy) || !isObject(contract.fields)
        || !Array.isArray(contract.fields.invoices)
        || typeof contract.contractDigest !== "string") {
        return { outcome: "DENIED", code: "FALL_ERP_READ_SOURCE_NOT_CLOSED", detail: "erpReadContract must be the verified reader connector contract (schemaVersion/tenantId/identity/fields/policy/contractDigest)." };
    }
    // The module RUNS THE RETAINED READER over the sealed source itself. The
    // reader enforces its own closed rules (contract digest, source self-seal,
    // freshness window, field policy, page size). A caller-resealed altered
    // fact cannot appear in this owned read: the read is derived from the
    // sealed export, not from caller-supplied facts.
    const ownedAdapter = createErpReadAdapterV1({
        contract,
        source,
        enabled: true,
        now: typeof input.erpReadNow === "string" ? input.erpReadNow : "",
    });
    const ownedRead = ownedAdapter({
        operation: "LIST_INVOICES",
        tenantId: contract.tenantId,
        principalId: contract.identity.principalId,
        scopes: contract.identity.scopes,
        credentialPresent: true,
        fields: contract.fields.invoices,
        pageSize: contract.policy.maxPageSize,
    });
    if (ownedRead.outcome !== "READ") {
        return { outcome: "DENIED", code: "FALL_ERP_READ_SOURCE_NOT_CLOSED", detail: `the retained reader refused the owned read of the sealed source (${ownedRead.code}); the reader chain cannot be established (no source authentication from caller-supplied input).` };
    }
    const readback = input.erpReadReadback;
    if (!isObject(readback) || readback.outcome !== "READ" || readback.entity !== "invoices"
        || !Array.isArray(readback.records) || readback.records.length === 0
        || !readback.records.every(isObject) || !isObject(readback.metadata) || !isSha256(readback.readbackDigest)) {
        return { outcome: "DENIED", code: "FALL_ERP_READ_READBACK_NOT_CLOSED", detail: "erpReadReadback must be the reader's closed READ invoices result (records/metadata/readbackDigest)." };
    }
    // The supplied READ result must equal the OWNED read exactly: digest,
    // every record (canonical) and the closed metadata. A tampered record
    // (e.g. totalMinor 2400 -> 2500) with a re-sealed readbackDigest/factsDigest
    // does not match the read derived from the sealed export.
    if (readback.readbackDigest !== ownedRead.readbackDigest
        || readback.records.length !== ownedRead.records.length
        || !readback.records.every((record, index) => canonicalJson(record) === canonicalJson(ownedRead.records[index]))
        || canonicalJson(readback.metadata) !== canonicalJson(ownedRead.metadata)) {
        return { outcome: "DENIED", code: "FALL_READER_SOURCE_BINDING_NOT_CLOSED", detail: "the supplied reader READ result does not equal the owned read over the sealed source (records/metadata/readbackDigest differ); a caller-resealed or altered fact is not source-bound input — the caller rehash does not authenticate the source." };
    }
    const records = ownedRead.records;
    const ownedMetadata = ownedRead.metadata;
    // ---- Retained reader attestation: must bind the EXACT owned records and
    // the SEALED source identity (not a caller-chosen value). ----
    const reader = input.reader;
    if (!isObject(reader) || !exactKeys(reader, ["trust", "sourceDatasetId", "sourceDigest", "factsDigest"])
        || reader.trust !== "LOCAL_SYNTHETIC"
        || typeof reader.sourceDatasetId !== "string" || reader.sourceDatasetId.length === 0
        || reader.sourceDatasetId !== ownedMetadata.sourceDatasetId
        || !isSha256(reader.sourceDigest)
        || reader.sourceDigest !== ownedMetadata.sourceDigest
        || !isSha256(reader.factsDigest)
        || reader.factsDigest !== readerFactsDigestV1(records)) {
        return { outcome: "DENIED", code: "FALL_READER_ATTESTATION_NOT_CLOSED", detail: "the erp-read facts must carry the retained reader's closed LOCAL_SYNTHETIC lineage attestation (trust/sourceDatasetId/sourceDigest/factsDigest); sourceDatasetId and sourceDigest must be the SEALED source's identity and the factsDigest must bind the attestation to the exact owned-read records." };
    }
    const binding = input.binding;
    if (!isObject(binding) || !exactKeys(binding, ["erpReadInvoiceId", "poReferenceId", "positionId", "bestellungId"])
        || typeof binding.erpReadInvoiceId !== "string" || binding.erpReadInvoiceId.length === 0
        || typeof binding.poReferenceId !== "string" || binding.poReferenceId.length === 0
        || typeof binding.positionId !== "string" || binding.positionId.length === 0
        || typeof binding.bestellungId !== "string" || binding.bestellungId.length === 0) {
        return { outcome: "DENIED", code: "FALL_BINDING_NOT_CLOSED", detail: "binding must carry the closed relation (erpReadInvoiceId, poReferenceId, positionId, bestellungId)." };
    }
    const position = isObject(input.entwurf) ? input.entwurf.positionen?.find((p) => p?.positionId === binding.positionId) : undefined;
    if (!isObject(input.entwurf) || input.entwurf.bestellungId !== binding.bestellungId || position === undefined) {
        return { outcome: "DENIED", code: "FALL_POSITION_UNKNOWN", detail: `position ${binding.positionId} is not a closed position of the Bestellentwurf ${binding.bestellungId}; the relation is missing.` };
    }
    const bestellteMenge = position.bestellteMenge;
    const positionEinheit = position.einheit;
    const positionWaehrung = position.waehrung;
    if (typeof bestellteMenge !== "number" || !Number.isSafeInteger(bestellteMenge) || bestellteMenge < 1) {
        return { outcome: "DENIED", code: "FALL_POSITION_MENGE_NOT_CLOSED", detail: `the bound position's bestellteMenge ${String(bestellteMenge)} is not a closed positive integer; the ordered quantity is not closed.` };
    }
    // The receipt is a REAL ledger from the receipt entrypoint. Its closed
    // ownership (bestellungId/positionId/einheit) is checked before any read;
    // an identical local positionId in another order is a DIFFERENT position.
    const ledger = input.receiptLedger;
    if (!isObject(ledger) || ledger.schemaVersion !== WARENEINGANG_LEDGER_SCHEMA_V1
        || !Array.isArray(ledger.eintraege) || !Array.isArray(ledger.appliedEingangsIds)
        || typeof ledger.bestellungId !== "string" || typeof ledger.positionId !== "string"
        || typeof ledger.einheit !== "string") {
        return { outcome: "DENIED", code: "FALL_RECEIPT_LEDGER_NOT_CLOSED", detail: "receiptLedger must be the closed receipt-entrypoint ledger (schema/ownership/entries/applied ids)." };
    }
    if (ledger.bestellungId !== binding.bestellungId) {
        return { outcome: "DENIED", code: "FALL_RECEIPT_BESTELLUNG_MISMATCH", detail: `receipt ledger belongs to bestellung ${ledger.bestellungId}, not the bound ${binding.bestellungId}.` };
    }
    if (ledger.positionId !== binding.positionId) {
        return { outcome: "DENIED", code: "FALL_RECEIPT_POSITION_MISMATCH", detail: `receipt ledger belongs to position ${ledger.positionId}, not the bound ${binding.positionId}; an identical local positionId in another order is a different closed identity.` };
    }
    if (ledger.einheit !== positionEinheit) {
        return { outcome: "DENIED", code: "FALL_RECEIPT_UNIT_MISMATCH", detail: `receipt ledger unit ${ledger.einheit} does not match the position closed unit ${String(positionEinheit)}.` };
    }
    // The received quantity is the REAL receipt-entrypoint readback (mengenzustandV1),
    // never a caller-supplied number.
    const mengenReceived = mengenzustandV1(input.entwurf, ledger).angenommeneMenge;
    if (typeof bestellteMenge === "number" && mengenReceived > bestellteMenge) {
        return { outcome: "DENIED", code: "FALL_RECEIPT_EXCEEDS_ORDERED", detail: `received ${mengenReceived} exceeds ordered ${bestellteMenge} in closed unit ${String(positionEinheit)}.` };
    }
    const supplier = input.supplierReference;
    const po = input.poReference;
    const supplierBody = isObject(supplier) ? supplier.body : undefined;
    if (supplierBody?.referenceKind !== "SUPPLIER" || typeof supplierBody.supplierId !== "string" || supplierBody.supplierId.length === 0) {
        return { outcome: "DENIED", code: "FALL_SUPPLIER_REFERENCE_INVALID", detail: "supplierReference must be a SUPPLIER reference body." };
    }
    const supplierId = supplierBody.supplierId;
    const poBody = isObject(po) ? po.body : undefined;
    if (poBody?.referenceKind !== "PURCHASE_ORDER" || poBody.referenceId !== binding.poReferenceId || poBody.supplierId !== supplierId) {
        const code = poBody?.referenceKind !== "PURCHASE_ORDER" || poBody.referenceId !== binding.poReferenceId
            ? "FALL_PO_REFERENCE_INVALID" : "FALL_PO_SUPPLIER_MISMATCH";
        return { outcome: "DENIED", code, detail: "the PO reference must carry the bound poReferenceId and the supplier closed identity." };
    }
    const erpFact = records.find((f) => f.invoiceId === binding.erpReadInvoiceId);
    if (erpFact === undefined) {
        return { outcome: "DENIED", code: "FALL_ERP_READ_FACT_MISSING", detail: `the erp-read fact ${binding.erpReadInvoiceId} is not present in the owned-read records; the relation cannot bind to an unknown invoice.` };
    }
    const applied = applyFachprofilToErpReadInvoiceV1(erpFact, profile);
    if (applied.outcome !== "MAPPED") {
        return { outcome: "DENIED", code: "FALL_M0_MAPPING_DENIED", detail: `the M0 profile denied the erp-read fact (${applied.code}); the amount sub-use is unresolved.` };
    }
    if (applied.reference.referenceId !== binding.erpReadInvoiceId) {
        return { outcome: "DENIED", code: "FALL_REFERENCE_ID_MISMATCH", detail: "the mapped INVOICE referenceId differs from the bound erp-read invoiceId." };
    }
    const tolerance = input.tolerancePolicy;
    if (!isObject(tolerance) || typeof tolerance.variantId !== "string" || tolerance.variantId.length === 0
        || typeof tolerance.version !== "string" || tolerance.version.length === 0) {
        return { outcome: "DENIED", code: "FALL_TOLERANCE_NOT_CLOSED", detail: "tolerancePolicy must be a closed versioned variant selection." };
    }
    // ---- Preserved receipt-dimension gates (corrected partial-receipt
    // behavior, unchanged) ----
    if (mengenReceived < 1) {
        return { outcome: "UNRESOLVED", code: "UNRESOLVED_NO_RECEIPT", detail: `no adopted receipt (mengenReceived ${mengenReceived}); the receipt dimension cannot be decided.` };
    }
    const valuation = input.receiptValuation;
    let valuationBody = null;
    if (valuation !== null) {
        const v = valuation;
        if (isObject(valuation) && valuation.schemaVersion === RECEIPT_VALUATION_SCHEMA_V1
            && valuation.referenceKind === "RECEIPT"
            && typeof valuation.referenceId === "string" && valuation.referenceId.length > 0
            && valuation.referenceId !== poBody.referenceId
            && typeof valuation.belegId === "string" && valuation.belegId.length > 0
            && valuation.bestellungId === binding.bestellungId
            && valuation.positionId === binding.positionId
            && valuation.supplierId === supplierId
            && valuation.einheit === positionEinheit
            && typeof valuation.waehrung === "string" && valuation.waehrung === positionWaehrung
            && typeof valuation.matchAmountMinor === "number" && Number.isSafeInteger(valuation.matchAmountMinor) && valuation.matchAmountMinor >= 0
            && isSha256(valuation.contentSha256)
            && valuation.contentSha256 === sha(receiptValuationCore(v))
            && isObject(valuation.evidence) && exactKeys(valuation.evidence, ["sourceKind", "locator", "generator", "attestedBy", "attestationNote"])
            && valuation.evidence.sourceKind === "LOCAL_SYNTHETIC_FIXTURE") {
            valuationBody = { matchAmountMinor: v.matchAmountMinor, referenceId: v.referenceId };
        }
    }
    if (valuationBody === null) {
        return { outcome: "UNRESOLVED", code: "UNRESOLVED_RECEIPT_VALUATION_ABSENT", detail: "no independently bound receipt valuation (or its seal/identity is not closed); the receipt dimension cannot be decided without an independent goods-receipt amount distinct from the PO." };
    }
    if (typeof bestellteMenge === "number" && mengenReceived < bestellteMenge) {
        return { outcome: "UNRESOLVED", code: "UNRESOLVED_PARTIAL_RECEIPT", detail: `received ${mengenReceived} < ordered ${bestellteMenge} in closed unit ${String(positionEinheit)}; a partial receipt does not complete the match.` };
    }
    // ---- The narrowed claim (explicit, non-decisive) ----
    // The decisive three-way purchase match is NOT assembled and NOT run: the
    // M0 profile declares the invoice-side supplierId and quantity as losses,
    // and a PO supplier identity and a quantity zero sentinel are NOT invoice
    // evidence. The real matcher is never invoked; the claim is narrowed to the
    // explicit synthetic INVOICE-vs-PO amount comparison under the frozen
    // tolerance variant.
    const poAmountMinor = poBody.matchAmountMinor;
    const toleranceEntry = pack.variants?.tolerancePolicies
        ?.find((entry) => entry.variantId === tolerance.variantId && entry.version === tolerance.version);
    if (typeof poAmountMinor !== "number" || !Number.isSafeInteger(poAmountMinor) || poAmountMinor < 0 || toleranceEntry === undefined) {
        const code = toleranceEntry === undefined ? "FALL_TOLERANCE_VARIANT_NOT_FROZEN" : "FALL_PO_REFERENCE_INVALID";
        return { outcome: "DENIED", code, detail: toleranceEntry === undefined
                ? `the tolerance variant ${tolerance.variantId} v${tolerance.version} is not present in the frozen pack registry; the comparison policy is not closed.`
                : "the PO reference does not carry a closed non-negative integer matchAmountMinor." };
    }
    const invoiceAmountMinor = applied.reference.matchAmountMinor;
    const deltaMinor = Math.abs(invoiceAmountMinor - poAmountMinor);
    const toleranceMinor = toleranceEntry.rateBasisPoints > 0
        ? Math.round((invoiceAmountMinor * toleranceEntry.rateBasisPoints) / 10000)
        : toleranceEntry.absoluteToleranceMinor;
    const agreement = deltaMinor <= toleranceMinor ? "AGREES" : "CONFLICTS";
    const core = {
        schemaVersion: RECHNUNGSABGLEICH_FALL_SCHEMA_V1,
        outcome: "RECHNUNGSABGLEICH_FALL",
        comparison: RECHNUNGSABGLEICH_COMPARISON_MODE_V1,
        decision: null,
        amountComparison: {
            invoiceAmountMinor,
            poAmountMinor,
            deltaMinor,
            tolerancePolicy: { variantId: tolerance.variantId, version: tolerance.version },
            agreement,
        },
        quantities: {
            bestellteMenge: bestellteMenge,
            mengenReceived,
            invoicedMenge: null,
            einheit: positionEinheit,
            waehrung: positionWaehrung,
        },
        receiptValuation: { referenceId: valuationBody.referenceId, matchAmountMinor: valuationBody.matchAmountMinor },
        declaredLossReasonCodes: applied.reference.declaredLossReasonCodes,
        purchaseMatch: {
            available: false,
            mode: RECHNUNGSABGLEICH_MATCHING_MODE_V1,
            reasonCode: UNRESOLVED_INVOICE_EVIDENCE_INCOMPLETE_V1,
            detail: `the decisive ${RECHNUNGSABGLEICH_MATCHING_MODE_V1} purchase match is unavailable on the erp-read source (declared M0 losses: ${applied.reference.declaredLossReasonCodes.join(", ")}); a PO supplier identity and a quantity zero sentinel are not invoice evidence. The result is an explicit synthetic INVOICE-vs-PO amount comparison only — not a purchase match, and no supplier/quantity is manufactured.`,
        },
        source: {
            sourceDatasetId: String(ownedMetadata.sourceDatasetId),
            sourceDigest: String(ownedMetadata.sourceDigest),
            readbackDigest: ownedRead.readbackDigest,
        },
    };
    return { ...core, fallDigest: sha(core) };
}
/** Verify a composition fall's closed digest against its content. */
export function verifyRechnungsabgleichFallDigestV1(value) {
    if (!isObject(value) || typeof value.fallDigest !== "string")
        return false;
    const core = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "fallDigest"));
    return value.fallDigest === sha(core);
}

import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { ERP_ORDER_SEMANTICS_V1, erpOrderConsumerV1, } from "./erp-order-capability-cell.js";
/**
 * M2 slice (Kundenauftrag / Lieferzusage), REUSE decision.
 *
 * This is a thin, closed fachliche framing that composes a *Kundenauftrag*
 * (customer order for discrete units) onto the already-reused
 * `cm.capability-cell/erp-order-profile/v1` capability cell
 * (consumer contract `erp.order.create/v1`). It does NOT re-implement order
 * creation, readback or rollback — it binds the fachliche request to the
 * cell's closed request identity, executes the reused core, and wraps the
 * cell receipt as a *Lieferzusage* with the cell's readback/rollback evidence.
 *
 * Closed semantic identities (no word-heuristic grants):
 *   - auftragsId  -> cell requestId   (closed token `request:erp-cell-*`)
 *   - artikelId   -> cell sku         (closed token `SYN-*`)
 *   - menge       -> cell quantity    (positive integer 1..100)
 *
 * Declared losses (the cell has no such concept — explicitly declared, not
 * word-mapped and not silently dropped):
 *   - kundeId      (no customer dimension in the cell)
 *   - lieferzusageFrist (no delivery-date dimension in the cell)
 *
 * A Lieferzusage is a *synthetic* delivery promise over the reused cell's
 * discrete-unit order; it grants no production authority.
 *
 * Availability and date bound (review finding F4): the cell's execution
 * proof (synthetic order insert/readback/rollback) is separated from a
 * stock/date-bound *proposal*. A closed date is checked SEMANTICALLY (month
 * 1..12, day within the month — 2026-09-99 and 2026-02-30 are DENIED, not
 * just format-checked) and must not be before the closed decision time
 * basis. Availability evidence is CLOSED: either the caller supplies a
 * Bestandsposition (physical/reserved/available, STK, the M3 inventory
 * identity) as explicit evidence, or it is declared UNBEWEIST. Missing or
 * unproven availability, a past/impossible date, or a shortage yield a
 * closed KLÄRUNG (clarification) — NOT a promise-shaped success. An
 * available-and-future proof yields LIEFERZUSAGE with the decision bound to
 * the cell receipt. This receipt is a synthetic local proof: it is NO proof
 * of a persisted order or completed delivery and is never used as delivery
 * evidence for complaints.
 */
export const KUNDENAUFTRAG_LIEFERZUSAGE_SCHEMA_V1 = "cm.fachprofil/kundenauftrag-lieferzusage/v1";
export const KUNDENAUFTRAG_ACTION_CONTRACT_V1 = "erp.order.create/v1";
export const KUNDENAUFTRAG_SEMANTICS_V1 = ERP_ORDER_SEMANTICS_V1;
/** A one-day closed horizon keeps the existing one-day synthetic acceptance current. */
export const KUNDENAUFTRAG_VERFUEGBARKEIT_MAX_ALTER_TAGE_V1 = 1;
export const KUNDENAUFTRAG_KLAERUNG_GRUND_CODE_V1 = [
    "VERFUEGBARKEIT_UNBEWEIST",
    "VERFUEGBARKEIT_VERALTET",
    "VERFUEGBARKEIT_ZUKUNFT",
    "ENGPASS_MENGE_OBER_VERFUEGBAR",
    "LIEFERFRIST_IN_VERGANGENHEIT",
    "LIEFERFRIST_UNREAL",
];
export const KUNDENAUFTRAG_DECLARED_LOSSES_V1 = [
    { reasonCode: "KUNDE_IDENTITY_NOT_IN_CELL", field: "kundeId", detail: "The erp.order.create cell has no customer dimension; kundeId is declared lost, not word-mapped." },
    { reasonCode: "LIEFERFRIST_NOT_IN_CELL", field: "lieferzusageFrist", detail: "The erp.order.create cell has no delivery-date dimension; the delivery promise date is declared lost." },
];
function sha(value) {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
const AUFTRAGSID_RE = /^request:erp-cell-[a-z0-9-]{3,64}$/;
const ARTIKELID_RE = /^SYN-[A-Z0-9-]{3,28}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Closed SEMANTIC ISO-date validation (F4): format alone is insufficient —
 * 2026-09-99 (day 99) and 2026-02-30 (Feb 30) must be rejected. The date must
 * be a real calendar date in a closed year range.
 */
function isClosedIsoDate(value) {
    if (typeof value !== "string" || !ISO_DATE_RE.test(value))
        return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1)
        return false;
    // real calendar day within the month (leap years handled by Date semantics)
    const endOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day <= endOfMonth;
}
/** Closed availability-evidence validation (F4). */
function verfuegbarkeitClosed(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const v = value;
    if (v.quelle === "UNBEWEIST") {
        return Object.keys(v).length === 1;
    }
    if (v.quelle !== "BESTANDSPOSITION_EVIDENCE")
        return false;
    if (Object.keys(v).length !== 3)
        return false;
    const pos = v.bestandsposition;
    if (typeof pos !== "object" || pos === null)
        return false;
    const p = pos;
    const keys = Object.keys(p).sort();
    const expected = ["artikelId", "einheit", "lagerortId", "physisch", "reserviert"];
    if (JSON.stringify(keys) !== JSON.stringify(expected))
        return false;
    if (typeof p.artikelId !== "string" || !/^SYN-ART-[A-Z0-9-]{3,28}$/.test(p.artikelId))
        return false;
    if (typeof p.lagerortId !== "string" || !/^LAGER-[A-Z0-9-]{2,28}$/.test(p.lagerortId))
        return false;
    if (p.einheit !== "STK")
        return false;
    if (typeof p.physisch !== "number" || !Number.isSafeInteger(p.physisch) || p.physisch < 0)
        return false;
    if (typeof p.reserviert !== "number" || !Number.isSafeInteger(p.reserviert) || p.reserviert < 0 || p.reserviert > p.physisch)
        return false;
    if (typeof v.beobachtetAm !== "string" || !isClosedIsoDate(v.beobachtetAm))
        return false;
    return true;
}
/** Derived available quantity from a stock position (M3 identity). */
function verfuegbarVonStock(p) {
    return p.physisch - p.reserviert;
}
/**
 * Bind a fachliche *Kundenauftrag* to the reused erp.order.create cell
 * request identity. Closed identities only; declared losses are explicit.
 * This does NOT execute — it produces the cell binding (pure, no side effect).
 */
export function bindKundenauftragToCellV1(request) {
    if (typeof request !== "object" || request === null) {
        return { outcome: "DENIED", code: "KUNDENAUFTRAG_REQUEST_NOT_OBJECT", detail: "Request is not an object." };
    }
    const r = request;
    const auftragsId = r.auftragsId;
    if (typeof auftragsId !== "string" || !AUFTRAGSID_RE.test(auftragsId)) {
        return { outcome: "DENIED", code: "KUNDENAUFTRAG_AUFTRAGSID_NOT_CLOSED", detail: `auftragsId ${String(auftragsId)} is not a closed cell requestId token (request:erp-cell-*).` };
    }
    const artikelId = r.artikelId;
    if (typeof artikelId !== "string" || !ARTIKELID_RE.test(artikelId)) {
        return { outcome: "DENIED", code: "KUNDENAUFTRAG_ARTIKELID_NOT_CLOSED", detail: `artikelId ${String(artikelId)} is not a closed cell sku token (SYN-*).` };
    }
    const menge = r.menge;
    if (typeof menge !== "number" || !Number.isSafeInteger(menge) || menge < 1 || menge > 100) {
        return { outcome: "DENIED", code: "KUNDENAUFTRAG_MENGE_NOT_IN_RANGE", detail: `menge ${String(menge)} is not an integer 1..100 discrete units.` };
    }
    const kundeId = r.kundeId;
    if (typeof kundeId !== "string" || kundeId.length === 0) {
        return { outcome: "DENIED", code: "KUNDENAUFTRAG_KUNDEID_MISSING", detail: "kundeId is required as a fachliche field (declared loss at the cell boundary)." };
    }
    const lieferzusageFrist = r.lieferzusageFrist;
    if (typeof lieferzusageFrist !== "string" || !isClosedIsoDate(lieferzusageFrist)) {
        return { outcome: "DENIED", code: "KUNDENAUFTRAG_LIEFERFRIST_NOT_ISO_DATE", detail: `lieferzusageFrist ${String(lieferzusageFrist)} is not a closed semantic ISO date (YYYY-MM-DD, a real calendar date).` };
    }
    const zeitbasis = r.zeitbasis;
    if (typeof zeitbasis !== "string" || !isClosedIsoDate(zeitbasis)) {
        return { outcome: "DENIED", code: "KUNDENAUFTRAG_ZEITBASIS_NOT_ISO_DATE", detail: `zeitbasis ${String(zeitbasis)} is not a closed semantic ISO date (YYYY-MM-DD, a real calendar date).` };
    }
    const verfuegbarkeit = r.verfuegbarkeit;
    if (!verfuegbarkeitClosed(verfuegbarkeit)) {
        return { outcome: "DENIED", code: "KUNDENAUFTRAG_VERFUEGBARKEIT_NOT_CLOSED", detail: "verfuegbarkeit must be a closed evidence (BESTANDSPOSITION_EVIDENCE with a valid stock position + beobachtetAm) or UNBEWEIST." };
    }
    const binding = {
        auftragsId, kundeId, artikelId, menge, lieferzusageFrist, zeitbasis, verfuegbarkeit,
        cellRequestId: auftragsId,
        cellSku: artikelId,
        cellQuantity: menge,
        declaredLossReasonCodes: KUNDENAUFTRAG_DECLARED_LOSSES_V1.map((l) => l.reasonCode),
    };
    return { outcome: "BOUND", binding };
}
/**
 * A closed KLÄRUNG (clarification) terminal (F4): missing/unproven
 * availability, a past or impossible date, or a shortage yield a
 * clarification, NOT a promise-shaped success. No cell is executed (no
 * synthetic order is created) — the cell execution proof is separated from
 * the stock/date-bound proposal.
 */
function klarungV1(b, grundCode, detail) {
    const core = {
        schemaVersion: KUNDENAUFTRAG_LIEFERZUSAGE_SCHEMA_V1,
        outcome: "KLARUNG_ERFORDERLICH",
        grundCode,
        auftragsId: b.auftragsId,
        kundeId: b.kundeId,
        artikelId: b.artikelId,
        menge: b.menge,
        lieferzusageFrist: b.lieferzusageFrist,
        zeitbasis: b.zeitbasis,
        verfuegbarkeit: b.verfuegbarkeit,
        declaredLossReasonCodes: b.declaredLossReasonCodes,
        detail,
    };
    return { ...core, klarungDigest: sha(core) };
}
/**
 * Decide and (only when the closed conditions hold) execute the
 * *Kundenauftrag* over the REAL reused cell entrypoint (erpOrderConsumerV1),
 * wrapping the cell receipt as a *Lieferzusage* bound to the stock/date
 * evidence. `cell` is the reused ErpOrderCapabilityCellV1 (its `execute`
 * consumer). Closed decision order (F4):
 *   1. date before the decision time basis -> KLARUNG (LIEFERFRIST_IN_VERGANGENHEIT)
 *   2. availability UNBEWEIST or no stock evidence -> KLARUNG (VERFUEGBARKEIT_UNBEWEIST)
 *   3. available < requested menge -> KLARUNG (ENGPASS_MENGE_OBER_VERFUEGBAR)
 *   4. otherwise the REAL cell executes; a cell denial is CELL_EXECUTION_DENIED;
 *      success -> LIEFERZUSAGE bound to the cell receipt + the evidence.
 * No cell is executed in a KLARUNG terminal (execution proof stays separated).
 */
export function executeKundenauftragAsLieferzusageV1(request, cell) {
    const bound = bindKundenauftragToCellV1(request);
    if (bound.outcome !== "BOUND")
        return bound;
    const b = bound.binding;
    // 1. closed date order: the promised date must not be before the decision
    //    time basis (ISO dates compare lexicographically for real dates).
    if (b.lieferzusageFrist < b.zeitbasis) {
        return { outcome: "KLARUNG", klarung: klarungV1(b, "LIEFERFRIST_IN_VERGANGENHEIT", `lieferzusageFrist ${b.lieferzusageFrist} is before the decision time basis ${b.zeitbasis}; a promise cannot be retroactive.`) };
    }
    // 2. closed availability: missing/unproven availability is a clarification,
    //    never a promise-shaped success.
    if (b.verfuegbarkeit.quelle === "UNBEWEIST") {
        return { outcome: "KLARUNG", klarung: klarungV1(b, "VERFUEGBARKEIT_UNBEWEIST", "no closed availability evidence (UNBEWEIST); availability is declared, not inferred.") };
    }
    // The sales boundary owns freshness too. A syntactically valid stock date
    // is not current merely because it has enough units. The one-day horizon is
    // deliberately the same closed synthetic acceptance used by the connected
    // journey, and the future case fails closed before any cell execution.
    const observedMs = Date.parse(`${b.verfuegbarkeit.beobachtetAm}T00:00:00Z`);
    const decisionMs = Date.parse(`${b.zeitbasis}T00:00:00Z`);
    const ageDays = (decisionMs - observedMs) / 86_400_000;
    if (!Number.isFinite(observedMs) || !Number.isFinite(decisionMs)) {
        return { outcome: "DENIED", code: "KUNDENAUFTRAG_VERFUEGBARKEIT_NOT_CLOSED", detail: "availability freshness could not be evaluated from the closed date evidence." };
    }
    if (ageDays < 0) {
        return { outcome: "KLARUNG", klarung: klarungV1(b, "VERFUEGBARKEIT_ZUKUNFT", `availability observed ${b.verfuegbarkeit.beobachtetAm} is after the decision basis ${b.zeitbasis}; future stock cannot support a promise.`) };
    }
    if (ageDays > KUNDENAUFTRAG_VERFUEGBARKEIT_MAX_ALTER_TAGE_V1) {
        return { outcome: "KLARUNG", klarung: klarungV1(b, "VERFUEGBARKEIT_VERALTET", `availability observed ${b.verfuegbarkeit.beobachtetAm} is ${ageDays} days old, beyond the closed ${KUNDENAUFTRAG_VERFUEGBARKEIT_MAX_ALTER_TAGE_V1}-day sales horizon.`) };
    }
    const verfuegbar = verfuegbarVonStock(b.verfuegbarkeit.bestandsposition);
    // 3. shortage: available below the requested menge is a clarification.
    if (verfuegbar < b.menge) {
        return { outcome: "KLARUNG", klarung: klarungV1(b, "ENGPASS_MENGE_OBER_VERFUEGBAR", `available ${verfuegbar} < requested ${b.menge}; a shortage yields a clarification, not a promise.`) };
    }
    // 4. closed conditions hold: the REAL reused cell executes.
    let cellReceipt;
    try {
        cellReceipt = erpOrderConsumerV1(cell, { requestId: b.cellRequestId, sku: b.cellSku, quantity: b.cellQuantity });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { outcome: "DENIED", code: "CELL_EXECUTION_DENIED", detail: `Reused cell denied: ${message}` };
    }
    const receiptCore = {
        schemaVersion: KUNDENAUFTRAG_LIEFERZUSAGE_SCHEMA_V1,
        outcome: "SYNTHETIC_LIEFERZUSAGE_FROM_ERP_ORDER_CELL",
        auftragsId: b.auftragsId,
        kundeId: b.kundeId,
        artikelId: b.artikelId,
        menge: b.menge,
        lieferzusageFrist: b.lieferzusageFrist,
        zeitbasis: b.zeitbasis,
        verfuegbarkeit: b.verfuegbarkeit,
        entscheidung: { art: "LIEFERZUSAGE", verfuegbar, menge: b.menge },
        declaredLossReasonCodes: b.declaredLossReasonCodes,
        actionContract: KUNDENAUFTRAG_ACTION_CONTRACT_V1,
        actionVersion: cellReceipt.actionVersion,
        cellProfileId: cellReceipt.profileId,
        cellProfileDigest: cellReceipt.profileDigest,
        cellBindingId: cellReceipt.bindingId,
        cellOrderId: cellReceipt.orderId,
        cellOutcome: cellReceipt.outcome,
        cellReadbackDigest: cellReceipt.readbackDigest,
        cellBeforeDigest: cellReceipt.beforeDigest,
        cellMutationDigest: cellReceipt.mutationDigest,
        cellFinalDigest: cellReceipt.finalDigest,
        cellEffectCount: cellReceipt.effectCount,
        cellRollbackCount: cellReceipt.rollbackCount,
        cellReceiptDigest: cellReceipt.receiptDigest,
    };
    const receipt = { ...receiptCore, lieferzusageDigest: sha(receiptCore) };
    return { outcome: "LIEFERZUSAGE", receipt };
}
/** Verify a Lieferzusage receipt's closed digest against its content. */
export function verifyLieferzusageDigestV1(receipt) {
    if (typeof receipt !== "object" || receipt === null)
        return false;
    const v = receipt;
    if (typeof v.lieferzusageDigest !== "string")
        return false;
    const core = Object.fromEntries(Object.entries(v).filter(([k]) => k !== "lieferzusageDigest"));
    return v.lieferzusageDigest === sha(core);
}

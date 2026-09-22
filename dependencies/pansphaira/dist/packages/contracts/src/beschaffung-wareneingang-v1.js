import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
/**
 * M1 slice 2 (Beschaffung / Wareneingang) — NEW local synthetic write path
 * (no Wareneingang predecessor exists in this repository; the rulewerk
 * authorizes implementing the concrete gap with a local synthetic write path
 * with readback and dedup — no external order dispatch, no booking).
 *
 * Fachliche core (not ERP column names): a *Bestellentwurf* (purchase order
 * draft) carries *Bestellpositionen*; a *Wareneingang* (goods receipt) event
 * is a versioned, deduplicated, readback-verified change. The three
 * separated quantity concepts are kept DISTINCT and only compared within
 * closed unit + currency dimensions:
 *   - bestellteMenge   (ordered)   — from the position
 *   - angenommeneMenge (received)  — sum of net (non-superseded) receipts
 *   - berechneteMenge  (invoiced)  — carried on the position by the
 *                                     reconciliation step (slice 1), not
 *                                     written here
 * plus a Korrekturbezug: a receipt may correct a prior receipt by closed
 * reference (supersede), not by blind re-write.
 *
 * Closed foreign-ledger isolation (review finding F2, probe P2): a
 * Wareneingang ledger is owned by the closed pair (bestellungId, positionId)
 * plus the closed unit. `foreignLedgerVerdict` rejects a ledger whose
 * ownership does not match BEFORE any entry is read, appended or corrected —
 * an identical local positionId in another order is a DIFFERENT closed
 * position (no equalization of equal local IDs). `wareneingangLedgerBildenV1`
 * opens the empty owned ledger; `wareneingangErfassenV1` and
 * `mengenzustandV1` both enforce the ownership.
 *
 * Closed identities (no word similarity as a grant):
 *   - bestellungId   : `bestellung:*`
 *   - positionId     : `position:*`
 *   - lieferantId    : `lieferant:*`
 *   - artikelId      : `EINK-ART-*` (procurement namespace, distinct from the
 *                      M3 inventory `SYN-ART-*` namespace — no equalization
 *                      of equal local IDs across modules)
 *   - eingangsId     : `wareneingang:*`
 *   - einheit        : closed non-empty uppercase token (STK, KG, PAAR, ...)
 *   - waehrung       : closed ISO-4217 uppercase token (EUR, ...)
 *
 * The Rechnungsabgleich connection (slice 1) is provided here as a
 * deterministic eligibility verdict on the closed quantity dimension; the
 * actual matching runs through the reused ERV core in slice 1.
 */
export const BESTELLUNGSENTWURF_SCHEMA_V1 = "cm.fachprofil/bestellentswurf/v1";
export const WARENEINGANG_SCHEMA_V1 = "cm.fachprofil/wareneingang/v1";
export const WARENEINGANG_LEDGER_SCHEMA_V1 = "cm.fachprofil/wareneingang-ledger/v1";
function sha(value) {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
const BESTELLUNGSID_RE = /^bestellung:[a-z0-9-]{3,64}$/;
const POSITIONID_RE = /^position:[a-z0-9-]{3,64}$/;
const LIEFERANTID_RE = /^lieferant:[a-z0-9-]{3,64}$/;
const ARTIKELID_RE = /^EINK-ART-[A-Z0-9-]{3,28}$/;
const EINGANGSID_RE = /^wareneingang:[a-z0-9-]{3,64}$/;
const EINHEIT_RE = /^[A-Z]{1,4}$/;
const WAHRUNGS_RE = /^[A-Z]{3}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
/**
 * Build a closed Bestellentwurf (purchase order draft) from adopted
 * Bestellpositionen. Validates the closed namespaces and the separated
 * quantity/unit/currency concepts; rejects duplicate position identity.
 */
export function bestellungsentwurfBildenV1(input) {
    if (!isRecord(input))
        return { outcome: "DENIED", code: "ENTWURF_NOT_OBJECT", detail: "Input is not an object." };
    const { bestellungId, lieferantId, bestellungZeitstempel, positionen } = input;
    if (typeof bestellungId !== "string" || !BESTELLUNGSID_RE.test(bestellungId)) {
        return { outcome: "DENIED", code: "ENTWURF_ID_NOT_CLOSED", detail: `bestellungId ${String(bestellungId)} is not a closed bestellung:* token.` };
    }
    if (typeof lieferantId !== "string" || !LIEFERANTID_RE.test(lieferantId)) {
        return { outcome: "DENIED", code: "ENTWURF_LIEFERANTID_NOT_CLOSED", detail: `lieferantId ${String(lieferantId)} is not a closed lieferant:* token.` };
    }
    if (typeof bestellungZeitstempel !== "string" || !ISO_DATETIME_RE.test(bestellungZeitstempel)) {
        return { outcome: "DENIED", code: "ENTWURF_ZEITSTAMPF_NOT_CLOSED", detail: `bestellungZeitstempel ${String(bestellungZeitstempel)} is not a closed ISO datetime.` };
    }
    if (!Array.isArray(positionen) || positionen.length === 0) {
        return { outcome: "DENIED", code: "ENTWURF_POSITIONEN_EMPTY", detail: "positionen must be a non-empty array of adopted Bestellpositionen." };
    }
    const seen = new Set();
    const normalized = [];
    for (let i = 0; i < positionen.length; i += 1) {
        const p = positionen[i];
        if (!isRecord(p))
            return { outcome: "DENIED", code: "POSITION_NOT_OBJECT", detail: `positionen[${i}] is not an object.` };
        const { positionId, artikelId, einheit, waehrung, bestellteMenge, berechneteMengeMinor } = p;
        if (typeof positionId !== "string" || !POSITIONID_RE.test(positionId)) {
            return { outcome: "DENIED", code: "POSITION_ID_NOT_CLOSED", detail: `positionen[${i}].positionId ${String(positionId)} is not a closed position:* token.` };
        }
        if (seen.has(positionId)) {
            return { outcome: "DENIED", code: "POSITION_ID_DUPLICATE", detail: `Duplicate positionId ${positionId}; the closed position identity must be unique.` };
        }
        seen.add(positionId);
        if (typeof artikelId !== "string" || !ARTIKELID_RE.test(artikelId)) {
            return { outcome: "DENIED", code: "POSITION_TOKENS_NOT_CLOSED", detail: `positionen[${i}].artikelId ${String(artikelId)} is not a closed EINK-ART-* token.` };
        }
        if (typeof einheit !== "string" || !EINHEIT_RE.test(einheit)) {
            return { outcome: "DENIED", code: "POSITION_UNIT_NOT_CLOSED", detail: `positionen[${i}].einheit ${String(einheit)} is not a closed unit token.` };
        }
        if (typeof waehrung !== "string" || !WAHRUNGS_RE.test(waehrung)) {
            return { outcome: "DENIED", code: "POSITION_CURRENCY_NOT_CLOSED", detail: `positionen[${i}].waehrung ${String(waehrung)} is not a closed ISO-4217 token.` };
        }
        if (typeof bestellteMenge !== "number" || !Number.isSafeInteger(bestellteMenge) || bestellteMenge < 1) {
            return { outcome: "DENIED", code: "POSITION_BESTELLTE_MENGE_NOT_POSITIVE", detail: `positionen[${i}].bestellteMenge ${String(bestellteMenge)} is not a positive integer.` };
        }
        if (berechneteMengeMinor !== null && (typeof berechneteMengeMinor !== "number" || !Number.isSafeInteger(berechneteMengeMinor) || berechneteMengeMinor < 0)) {
            return { outcome: "DENIED", code: "POSITION_BERECHNETE_MENGE_NOT_MINOR", detail: `positionen[${i}].berechneteMengeMinor must be null or a non-negative integer minor.` };
        }
        normalized.push({ positionId, artikelId, einheit, waehrung, bestellteMenge, berechneteMengeMinor });
    }
    const core = { schemaVersion: BESTELLUNGSENTWURF_SCHEMA_V1, bestellungId, lieferantId, bestellungZeitstempel, positionen: normalized };
    const entwurf = { ...core, entwurfDigest: sha(core) };
    return { outcome: "ENTWURF", entwurf };
}
export function mengenzustandV1(entwurf, ledger) {
    const position = entwurf.positionen.find((p) => p.positionId === (ledger?.positionId ?? "")) ?? entwurf.positionen[0];
    if (position === undefined)
        throw new Error("no position");
    // F2: a ledger whose closed ownership (bestellungId/positionId/einheit)
    // does not match is FOREIGN — its quantities are never reported.
    const relevant = ledger !== null
        && foreignLedgerVerdict(entwurf, position, ledger).outcome === "OWN"
        ? ledger
        : null;
    const angenommene = relevant !== null
        ? relevant.eintraege.filter((e) => !e.ersetzt).reduce((sum, e) => sum + e.menge, 0)
        : 0;
    return {
        positionId: position.positionId,
        einheit: position.einheit,
        waehrung: position.waehrung,
        bestellteMenge: position.bestellteMenge,
        angenommeneMenge: angenommene,
        berechneteMengeMinor: position.berechneteMengeMinor,
    };
}
function ledgerDigest(ledger) {
    return sha({ schemaVersion: WARENEINGANG_LEDGER_SCHEMA_V1, ...ledger });
}
/**
 * Closed foreign-ledger isolation (review finding F2): a Wareneingang ledger
 * is owned by the closed pair (bestellungId, positionId) plus the closed unit.
 * A ledger whose ownership does not match the Bestellentwurf / selected
 * position must be rejected BEFORE any entry is read, appended or corrected —
 * an identical local positionId in another order is a DIFFERENT position
 * (no equalization of equal local IDs across orders). This is the rule that
 * the neighbor-reuse contract requires; it is checked at every entrypoint
 * that accepts a ledger.
 */
function foreignLedgerVerdict(entwurf, position, ledger) {
    if (ledger.schemaVersion !== WARENEINGANG_LEDGER_SCHEMA_V1
        || !Array.isArray(ledger.eintraege) || !Array.isArray(ledger.appliedEingangsIds)) {
        return { outcome: "DENIED", code: "WARENEINGANG_LEDGER_NOT_CLOSED", detail: `ledger schema ${String(ledger.schemaVersion)} is not the closed ${WARENEINGANG_LEDGER_SCHEMA_V1} ledger shape.` };
    }
    if (ledger.bestellungId !== entwurf.bestellungId) {
        return { outcome: "DENIED", code: "WARENEINGANG_LEDGER_FOREIGN_BESTELLUNG", detail: `ledger belongs to bestellung ${ledger.bestellungId}, not to the Entwurfs closed identity ${entwurf.bestellungId}; a foreign ledger is rejected before any read or write.` };
    }
    if (ledger.positionId !== position.positionId) {
        return { outcome: "DENIED", code: "WARENEINGANG_LEDGER_FOREIGN_POSITION", detail: `ledger belongs to position ${ledger.positionId}, not to the selected position ${position.positionId}; an identical local positionId in another order/position is a different closed identity.` };
    }
    if (ledger.einheit !== position.einheit) {
        return { outcome: "DENIED", code: "WARENEINGANG_LEDGER_UNIT_MISMATCH", detail: `ledger unit ${ledger.einheit} does not match the position closed unit ${position.einheit}; quantities are only comparable in the same closed unit.` };
    }
    return { outcome: "OWN" };
}
/**
 * Open the closed per-position Wareneingang ledger for one Bestellentwurf
 * position. The ledger is OWNED by (bestellungId, positionId, einheit) — the
 * ownership is what the foreign-ledger isolation checks against. An empty
 * ledger is the neutral starting point of the local synthetic write path.
 */
export function wareneingangLedgerBildenV1(entwurf, positionId) {
    if (!isRecord(entwurf)) {
        return { outcome: "DENIED", code: "ENTWURF_NOT_OBJECT", detail: "Entwurf is not a closed BestellentwurfV1." };
    }
    const position = entwurf.positionen.find((p) => p.positionId === positionId);
    if (position === undefined) {
        return { outcome: "DENIED", code: "WARENEINGANG_LEDGER_POSITION_UNKNOWN", detail: `positionId ${positionId} is not a position of the Bestellentwurf; no ledger can be opened for an unknown position.` };
    }
    const ledger = {
        schemaVersion: WARENEINGANG_LEDGER_SCHEMA_V1,
        bestellungId: entwurf.bestellungId,
        positionId: position.positionId,
        einheit: position.einheit,
        eintraege: [],
        appliedEingangsIds: [],
    };
    return { outcome: "LEDGER", ledger };
}
/**
 * Erfaessung eines (Teil-)Wareneingangs — the local synthetic WRITE path with
 * readback and dedup. `entwurf` is the closed Bestellentwurf the position must
 * belong to; `ledger` is the per-position Wareneingang ledger (null if none
 * yet). A repeated eingangsId is a closed denial (Doppelereignis, no blind
 * re-write). The Einheit must match the position (closed dimension). The
 * running net received quantity may not exceed the ordered quantity (closed
 * fachliche bound). A Korrekturbezug (korrekturVon) must reference an existing
 * non-superseded eingangsId and replaces it (net effect: new − old), never a
 * blind second write.
 */
export function wareneingangErfassenV1(entwurf, ledger, eingang) {
    if (!isRecord(entwurf)) {
        return { outcome: "DENIED", code: "WARENEINGANG_BESTELLUNGID_NOT_CLOSED", detail: "Entwurf is not a closed BestellentwurfV1." };
    }
    if (!isRecord(eingang))
        return { outcome: "DENIED", code: "WARENEINGANG_NOT_OBJECT", detail: "Wareneingang is not an object." };
    const { eingangsId, bestellungId, positionId, einheit, menge, zeitstempel, korrekturVon } = eingang;
    if (typeof eingangsId !== "string" || !EINGANGSID_RE.test(eingangsId)) {
        return { outcome: "DENIED", code: "WARENEINGANG_ID_NOT_CLOSED", detail: `eingangsId ${String(eingangsId)} is not a closed wareneingang:* token.` };
    }
    if (typeof bestellungId !== "string" || bestellungId !== entwurf.bestellungId) {
        return { outcome: "DENIED", code: "WARENEINGANG_BESTELLUNGID_NOT_CLOSED", detail: `bestellungId ${String(bestellungId)} does not match the Entwurfs closed identity ${entwurf.bestellungId}.` };
    }
    const position = entwurf.positionen.find((p) => p.positionId === positionId);
    if (position === undefined) {
        return { outcome: "DENIED", code: "WARENEINGANG_POSITION_UNKNOWN", detail: `positionId ${String(positionId)} is not a position of the Bestellentwurf; the relation is missing.` };
    }
    // Closed foreign-ledger isolation (F2): the incoming ledger must belong to
    // this bestellungId + selected positionId + closed unit BEFORE anything is
    // read, appended or corrected. A foreign ledger is rejected wholesale —
    // checked before the incoming event's own dimension validation, because the
    // ledger's closed ownership is independent of the incoming menge/einheit.
    if (ledger !== null) {
        const ownership = foreignLedgerVerdict(entwurf, position, ledger);
        if (ownership.outcome === "DENIED")
            return ownership;
    }
    if (typeof einheit !== "string" || einheit !== position.einheit) {
        return { outcome: "DENIED", code: "WARENEINGANG_UNIT_MISMATCH", detail: `einheit ${String(einheit)} does not match the position closed unit ${position.einheit}; quantities are only comparable in the same closed unit.` };
    }
    if (typeof menge !== "number" || !Number.isSafeInteger(menge) || menge < 1) {
        return { outcome: "DENIED", code: "WARENEINGANG_MENGE_NOT_POSITIVE", detail: `menge ${String(menge)} is not a positive integer.` };
    }
    if (typeof zeitstempel !== "string" || !ISO_DATETIME_RE.test(zeitstempel)) {
        return { outcome: "DENIED", code: "WARENEINGANG_ZEITSTAMPF_NOT_CLOSED", detail: `zeitstempel ${String(zeitstempel)} is not a closed ISO datetime.` };
    }
    const baseEintraege = ledger
        ? ledger.eintraege.map((e) => ({ ...e }))
        : [];
    const baseApplied = ledger ? [...ledger.appliedEingangsIds] : [];
    if (baseApplied.includes(eingangsId)) {
        return { outcome: "DENIED", code: "WARENEINGANG_REPLAY_DENIED", detail: `eingangsId ${eingangsId} was already recorded; a double event is denied (no blind re-write).` };
    }
    // Korrekturbezug: must reference an existing, still-effective eingangsId
    if (korrekturVon !== null) {
        if (typeof korrekturVon !== "string") {
            return { outcome: "DENIED", code: "WARENEINGANG_KORREKTUR_REF_NOT_ERSETZBAR", detail: `korrekturVon ${String(korrekturVon)} must be a closed eingangsId reference or null.` };
        }
        const target = baseEintraege.find((e) => e.eingangsId === korrekturVon);
        if (target === undefined) {
            return { outcome: "DENIED", code: "WARENEINGANG_KORREKTUR_REF_UNKNOWN", detail: `korrekturVon ${korrekturVon} is not a recorded eingangsId; a correction must reference a real event.` };
        }
        if (target.ersetzt) {
            return { outcome: "DENIED", code: "WARENEINGANG_KORREKTUR_REF_NOT_ERSETZBAR", detail: `korrekturVon ${korrekturVon} is already superseded; only the latest effective event is correctable.` };
        }
    }
    // running net: supersede the target if present, then add the new event
    let eintraege = baseEintraege.map((e) => e);
    if (korrekturVon !== null && typeof korrekturVon === "string") {
        eintraege = eintraege.map((e) => (e.eingangsId === korrekturVon ? { ...e, ersetzt: true } : e));
    }
    eintraege = [...eintraege, { eingangsId, positionId: position.positionId, menge, korrekturVon, ersetzt: false }];
    const net = eintraege.filter((e) => !e.ersetzt).reduce((sum, e) => sum + e.menge, 0);
    if (net > position.bestellteMenge) {
        return { outcome: "DENIED", code: "WARENEINGANG_OVER_RECEIPT_DENIED", detail: `net received ${net} exceeds bestellteMenge ${position.bestellteMenge} in closed unit ${position.einheit}; an over-receipt is denied (no silent partial acceptance).` };
    }
    const appliedEingangsIds = [...baseApplied, eingangsId];
    const newLedger = {
        schemaVersion: WARENEINGANG_LEDGER_SCHEMA_V1,
        bestellungId: entwurf.bestellungId,
        positionId: position.positionId,
        einheit: position.einheit,
        eintraege,
        appliedEingangsIds,
    };
    // READBACK: recompute the net from the persisted ledger and verify it
    const readbackNet = newLedger.eintraege.filter((e) => !e.ersetzt).reduce((sum, e) => sum + e.menge, 0);
    if (readbackNet !== net) {
        return { outcome: "DENIED", code: "WARENEINGANG_POSITION_UNKNOWN", detail: "readback mismatch: the Wareneingang did not persist as recorded." };
    }
    return {
        outcome: "WARENEINGANG_ERFASST",
        ledger: newLedger,
        position: {
            positionId: position.positionId,
            einheit: position.einheit,
            waehrung: position.waehrung,
            bestellteMenge: position.bestellteMenge,
            angenommeneMenge: readbackNet,
            berechneteMengeMinor: position.berechneteMengeMinor,
        },
        beforeDigest: ledger ? ledgerDigest({ bestellungId: ledger.bestellungId, positionId: ledger.positionId, einheit: ledger.einheit, eintraege: ledger.eintraege, appliedEingangsIds: ledger.appliedEingangsIds }) : sha({ empty: true }),
        afterDigest: ledgerDigest({ bestellungId: newLedger.bestellungId, positionId: newLedger.positionId, einheit: newLedger.einheit, eintraege: newLedger.eintraege, appliedEingangsIds: newLedger.appliedEingangsIds }),
    };
}
export function rechnungsabgleichFertigkeitV1(position, angenommeneMenge) {
    if (typeof position.waehrung !== "string" || !WAHRUNGS_RE.test(position.waehrung)) {
        return { outcome: "ABGLEICH_BLOCKED", code: "CURRENCY_UNKNOWN", positionId: position.positionId, detail: `waehrung ${String(position.waehrung)} is not a closed currency; the amount dimension is unresolved.` };
    }
    if (angenommeneMenge < 1) {
        return { outcome: "ABGLEICH_BLOCKED", code: "NO_RECEIPT", positionId: position.positionId, detail: `no adopted receipt (angenommeneMenge ${angenommeneMenge}); nothing to reconcile.` };
    }
    if (angenommeneMenge > position.bestellteMenge) {
        return { outcome: "ABGLEICH_BLOCKED", code: "OVER_RECEIVED", positionId: position.positionId, detail: `angenommeneMenge ${angenommeneMenge} exceeds bestellteMenge ${position.bestellteMenge}; reconcile only the adopted part (partial-set semantics).` };
    }
    return { outcome: "ABGLEICH_FERTIGKEIT", positionId: position.positionId, bestellteMenge: position.bestellteMenge, angenommeneMenge, einheit: position.einheit, waehrung: position.waehrung };
}

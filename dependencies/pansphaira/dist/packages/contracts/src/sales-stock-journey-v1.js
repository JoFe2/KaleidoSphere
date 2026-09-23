import { bestellungsentwurfBildenV1, wareneingangErfassenV1, } from "./beschaffung-wareneingang-v1.js";
import { BESTAND_UNIT_V1, bestandAenderungAnwendenV1, bestandslageBerechnenV1, nachschubEntscheidenFrischeV1, verifyBestandslageDigestV1, wareneingangZuBestandsaenderungV1, } from "./bestand-nachschub-v1.js";
import { ErpOrderCapabilityCellV1, syntheticErpOrderProfilesV1 } from "./erp-order-capability-cell.js";
import { syntheticCapabilityCatalogueV1 } from "./capability-catalogue.js";
import { executeKundenauftragAsLieferzusageV1 } from "./kundenauftrag-lieferzusage-v1.js";
/**
 * PAN435–436 connected local journey.
 *
 * This is deliberately a local, labelled synthetic composition. It connects
 * the corrected M1 receipt entrypoint to M3 through the explicit retained
 * identity/unit adapter, evaluates a stock/date-bound M2 proposal over the
 * existing synthetic ERP order cell, then records a source-bound M2
 * reservation in M3 and makes a freshness-bound replenishment proposal.
 * No provider, network, notification, procurement dispatch, or durable
 * production write is involved.
 */
export const SALES_STOCK_JOURNEY_SCHEMA_V1 = "cm.journey/sales-stock-local/v1";
export const SALES_STOCK_JOURNEY_SOURCE_V1 = "LOCAL_SYNTHETIC_LABELLED";
export const SALES_STOCK_JOURNEY_ADAPTER_ID_V1 = "adapter:m1-eink-001-to-m3-syn-art-001-to-m2-cell-001";
export const DEFAULT_SALES_STOCK_JOURNEY_INPUT_V1 = {
    receiptQuantity: 50,
    requestedQuantity: 60,
    reservationQuantity: 60,
    replenishmentThreshold: 20,
    replenishmentQuantity: 40,
    observedAt: "2026-09-21T08:00:00Z",
    receiptAt: "2026-09-21T09:00:00Z",
    decisionAt: "2026-09-21T12:00:00Z",
    promisedDate: "2026-09-23",
};
const IDENTITY = {
    m1ArtikelId: "EINK-ART-001",
    m3ArtikelId: "SYN-ART-001",
    m3LagerortId: "LAGER-01",
    m2ArtikelId: "SYN-CELL-ERP-01",
    einheit: BESTAND_UNIT_V1,
    adapterId: SALES_STOCK_JOURNEY_ADAPTER_ID_V1,
};
const M1_TO_M3_ADAPTER = {
    adapterId: SALES_STOCK_JOURNEY_ADAPTER_ID_V1,
    mappingen: [{
            m1ArtikelId: IDENTITY.m1ArtikelId,
            m3ArtikelId: IDENTITY.m3ArtikelId,
            m3LagerortId: IDENTITY.m3LagerortId,
            einheit: IDENTITY.einheit,
        }],
};
const NON_CLAIMS = [
    "LOCAL_SYNTHETIC_LABELLED is not external ERP or warehouse evidence.",
    "The ERP order-cell receipt proves only synthetic local readback and rollback, not a persisted order or completed delivery.",
    "The replenishment result is a nonbinding proposal; no procurement or provider write is performed.",
];
function denied(stage, value, codeOverride) {
    const result = value;
    return {
        schemaVersion: SALES_STOCK_JOURNEY_SCHEMA_V1,
        source: SALES_STOCK_JOURNEY_SOURCE_V1,
        outcome: "DENIED",
        stage,
        code: codeOverride ?? (typeof result.code === "string" ? result.code : "STAGE_DENIED"),
        detail: typeof result.detail === "string" ? result.detail : `Stage ${stage} did not produce a closed result.`,
    };
}
function closedDateTime(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value))
        return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().replace(".000Z", "Z") === value;
}
function inputClosed(input) {
    if (input === null || typeof input !== "object")
        return false;
    const value = input;
    const integers = ["receiptQuantity", "requestedQuantity", "reservationQuantity", "replenishmentThreshold", "replenishmentQuantity"];
    if (integers.some((key) => !Number.isSafeInteger(value[key]) || value[key] < 1))
        return false;
    const dates = ["observedAt", "receiptAt", "decisionAt"];
    if (dates.some((key) => !closedDateTime(value[key])))
        return false;
    if (typeof value.promisedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.promisedDate))
        return false;
    return true;
}
function reservedStockQuantity(lage) {
    const position = lage.positions.find(({ artikelId, lagerortId }) => artikelId === IDENTITY.m3ArtikelId && lagerortId === IDENTITY.m3LagerortId);
    return position === undefined ? 0 : position.physisch - position.reserviert;
}
function stockEvidence(input, physical, reserved) {
    return {
        quelle: "BESTANDSPOSITION_EVIDENCE",
        bestandsposition: {
            artikelId: IDENTITY.m3ArtikelId,
            lagerortId: IDENTITY.m3LagerortId,
            einheit: BESTAND_UNIT_V1,
            physisch: physical,
            reserviert: reserved,
        },
        // The M2 evidence cites the retained M3 observation date; it does not
        // mint freshness from the caller's decision timestamp.
        beobachtetAm: input.observedAt.slice(0, 10),
    };
}
/** Execute the complete connected M1 receipt -> M3 stock -> M2 proposal -> M3 reservation -> replenishment path. */
export function runSalesStockJourneyV1(input = DEFAULT_SALES_STOCK_JOURNEY_INPUT_V1) {
    if (!inputClosed(input))
        return denied("INPUT", { code: "JOURNEY_INPUT_NOT_CLOSED", detail: "Journey quantities must be positive safe integers and timestamps/dates must use closed ISO forms." });
    const value = input;
    const observedMs = Date.parse(value.observedAt);
    const receiptMs = Date.parse(value.receiptAt);
    const decisionMs = Date.parse(value.decisionAt);
    if (!(observedMs <= receiptMs && receiptMs <= decisionMs)) {
        return denied("INPUT", {
            code: "JOURNEY_TIMESTAMP_ORDER_INVALID",
            detail: `Stock observation, receipt and decision must be ordered observedAt <= receiptAt <= decisionAt; received ${value.observedAt} <= ${value.receiptAt} <= ${value.decisionAt}.`,
        });
    }
    const orderResult = bestellungsentwurfBildenV1({
        bestellungId: "bestellung:sales-stock-001",
        lieferantId: "lieferant:synthetic-001",
        bestellungZeitstempel: "2026-09-21T07:30:00Z",
        positionen: [{
                positionId: "position:sales-stock-001",
                artikelId: IDENTITY.m1ArtikelId,
                einheit: IDENTITY.einheit,
                waehrung: "EUR",
                bestellteMenge: 100,
                berechneteMengeMinor: null,
            }],
    });
    if (orderResult.outcome !== "ENTWURF")
        return denied("BESTELLUNG", orderResult);
    const receiptResult = wareneingangErfassenV1(orderResult.entwurf, null, {
        eingangsId: "wareneingang:sales-stock-001",
        bestellungId: orderResult.entwurf.bestellungId,
        positionId: "position:sales-stock-001",
        einheit: IDENTITY.einheit,
        menge: value.receiptQuantity,
        zeitstempel: value.receiptAt,
        korrekturVon: null,
    });
    if (receiptResult.outcome !== "WARENEINGANG_ERFASST")
        return denied("WARENEINGANG", receiptResult);
    const mapped = wareneingangZuBestandsaenderungV1({
        adapter: M1_TO_M3_ADAPTER,
        m1Entwurf: orderResult.entwurf,
        m1Ledger: receiptResult.ledger,
        m1EingangsId: "wareneingang:sales-stock-001",
        m1Quelle: "m1-wareneingang-local-synthetic",
        m1Zeitstempel: value.receiptAt,
        m3Ziel: { artikelId: IDENTITY.m3ArtikelId, lagerortId: IDENTITY.m3LagerortId },
    });
    if (mapped.outcome !== "BELEGT")
        return denied("M1_TO_M3_ADAPTER", mapped);
    const initialStock = bestandslageBerechnenV1([{
            artikelId: IDENTITY.m3ArtikelId,
            lagerortId: IDENTITY.m3LagerortId,
            einheit: BESTAND_UNIT_V1,
            physisch: 20,
            reserviert: 0,
            herkunft: { quelle: "m3-local-synthetic-stock", beobachtetAm: value.observedAt, quelleRevision: "stock-rev-001" },
        }]);
    if (initialStock.outcome !== "LAGE")
        return denied("BESTAND_INITIAL", initialStock);
    const receivedStock = bestandAenderungAnwendenV1(initialStock.lage, mapped.aenderung, []);
    if (receivedStock.outcome !== "GEAENDERT")
        return denied("BESTAND_RECEIPT", receivedStock);
    if (!verifyBestandslageDigestV1(receivedStock.lage.lage))
        return denied("BESTAND_RECEIPT", { code: "BESTAND_DIGEST_READBACK_FAILED", detail: "the receipt state failed its digest readback." });
    const catalogue = syntheticCapabilityCatalogueV1();
    const profiles = syntheticErpOrderProfilesV1(catalogue);
    const cell = new ErpOrderCapabilityCellV1({ catalogue, profiles, activeProfileDigest: profiles[0].profileDigest });
    const proposal = executeKundenauftragAsLieferzusageV1({
        auftragsId: "request:erp-cell-sales-stock-001",
        kundeId: "kunde:synthetic-001",
        artikelId: IDENTITY.m2ArtikelId,
        menge: value.requestedQuantity,
        lieferzusageFrist: value.promisedDate,
        zeitbasis: value.decisionAt.slice(0, 10),
        verfuegbarkeit: stockEvidence(value, receivedStock.lage.lage.positions[0]?.physisch ?? 0, receivedStock.lage.lage.positions[0]?.reserviert ?? 0),
    }, cell);
    if (proposal.outcome === "DENIED")
        return denied("LIEFERPROPOSAL", proposal);
    if (proposal.outcome === "KLARUNG") {
        return {
            schemaVersion: SALES_STOCK_JOURNEY_SCHEMA_V1,
            source: SALES_STOCK_JOURNEY_SOURCE_V1,
            outcome: "CONNECTED_SALES_STOCK_CLARIFICATION",
            identity: IDENTITY,
            stage: "LIEFERPROPOSAL",
            clarification: proposal.klarung,
            nonClaims: NON_CLAIMS,
        };
    }
    const availableForReservation = reservedStockQuantity(receivedStock.lage.lage);
    if (value.reservationQuantity !== proposal.receipt.entscheidung.menge) {
        // Preserve the original insufficient-stock terminal for an over-available
        // negative probe, but never let any mismatched quantity become a success.
        if (value.reservationQuantity > availableForReservation) {
            return denied("BESTAND_RESERVATION", {
                code: "AENDERUNG_INSUFFICIENT_AVAILABLE",
                detail: `RESERVIERUNG ${value.reservationQuantity} exceeds verfuegbar ${availableForReservation}; the requested reservation is both mismatched and unavailable.`,
            });
        }
        return denied("BESTAND_RESERVATION", {
            code: "RESERVATION_QUANTITY_MISMATCH",
            detail: `reservationQuantity ${value.reservationQuantity} does not equal the accepted sales quantity ${proposal.receipt.entscheidung.menge}; a connected success cannot be under- or over-reserved.`,
        });
    }
    const reservation = {
        schemaVersion: "cm.fachprofil/bestand-aenderung/v1",
        aenderungsId: "aenderung:bestand-kundenauftrag-sales-stock-001",
        artikelId: IDENTITY.m3ArtikelId,
        lagerortId: IDENTITY.m3LagerortId,
        einheit: BESTAND_UNIT_V1,
        art: "RESERVIERUNG",
        menge: proposal.receipt.entscheidung.menge,
        zeitstempel: value.decisionAt,
        beleg: {
            belegId: "request:erp-cell-sales-stock-001",
            belegArt: "KUNDENAUFTRAG",
            quelle: "m2-kundenauftrag-local-synthetic",
            zeitstempel: value.decisionAt,
        },
    };
    const reservedStock = bestandAenderungAnwendenV1(receivedStock.lage.lage, reservation, receivedStock.lage.appliedAenderungsIds);
    if (reservedStock.outcome !== "GEAENDERT")
        return denied("BESTAND_RESERVATION", reservedStock);
    if (!verifyBestandslageDigestV1(reservedStock.lage.lage))
        return denied("BESTAND_RESERVATION", { code: "BESTAND_DIGEST_READBACK_FAILED", detail: "the reservation state failed its digest readback." });
    const replenishment = nachschubEntscheidenFrischeV1(reservedStock.lage.lage, {
        anforderungsId: "nachschub:sales-stock-001",
        artikelId: IDENTITY.m3ArtikelId,
        lagerortId: IDENTITY.m3LagerortId,
        einheit: BESTAND_UNIT_V1,
        schwellenwert: value.replenishmentThreshold,
        nachschubmenge: value.replenishmentQuantity,
        grund: "verfuegbarer Bestand nach Kundenauftragsreservierung unter Mindestbestand",
    }, {
        politikId: "frische:sales-stock-001",
        version: "1",
        maximalerAlterSekunden: 86_400,
        entscheidungsZeitpunkt: value.decisionAt,
    });
    if (replenishment.outcome === "DENIED")
        return denied("NACHSCHUB", replenishment);
    if (replenishment.outcome === "BESTANDSFRISCHHEIT_UNBEWEIST")
        return denied("NACHSCHUB", replenishment, "BESTANDSFRISCHHEIT_UNBEWEIST");
    if (replenishment.outcome === "BESTANDSFRISCHHEIT_VERALTET")
        return denied("NACHSCHUB", replenishment, "BESTANDSFRISCHHEIT_VERALTET");
    return {
        schemaVersion: SALES_STOCK_JOURNEY_SCHEMA_V1,
        source: SALES_STOCK_JOURNEY_SOURCE_V1,
        outcome: "CONNECTED_SALES_STOCK_JOURNEY",
        identity: IDENTITY,
        stages: {
            bestellung: orderResult.entwurf,
            wareneingang: {
                eingangsId: "wareneingang:sales-stock-001",
                ledger: receiptResult.ledger,
                angenommeneMenge: receiptResult.position.angenommeneMenge,
            },
            stockAfterReceipt: receivedStock.lage.lage,
            lieferproposal: proposal.receipt,
            reservation: { aenderung: reservation, lage: reservedStock.lage.lage },
            replenishment,
        },
        nonClaims: NON_CLAIMS,
    };
}
/** A small explicit negative probe surface used by the offline CLI. */
export function runSalesStockNegativeProbeV1(caseName) {
    if (caseName === "receipt-zero")
        return runSalesStockJourneyV1({ ...DEFAULT_SALES_STOCK_JOURNEY_INPUT_V1, receiptQuantity: 0 });
    if (caseName === "shortage")
        return runSalesStockJourneyV1({ ...DEFAULT_SALES_STOCK_JOURNEY_INPUT_V1, requestedQuantity: 80 });
    if (caseName === "reservation-conflict")
        return runSalesStockJourneyV1({ ...DEFAULT_SALES_STOCK_JOURNEY_INPUT_V1, reservationQuantity: 71 });
    if (caseName === "stale-observation")
        return runSalesStockJourneyV1({ ...DEFAULT_SALES_STOCK_JOURNEY_INPUT_V1, observedAt: "2000-01-01T00:00:00Z" });
    return denied("NEGATIVE_PROBE", { code: "NEGATIVE_PROBE_UNKNOWN", detail: `Unknown negative probe ${caseName}.` });
}

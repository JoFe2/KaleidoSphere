import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { syntheticCapabilityCatalogueV1, verifyCapabilityCatalogueV1, } from "./capability-catalogue.js";
export const ERP_ORDER_PROFILE_SCHEMA_V1 = "cm.capability-cell/erp-order-profile/v1";
export const ERP_ORDER_RECEIPT_SCHEMA_V1 = "cm.capability-cell/erp-order-receipt/v1";
export const ERP_ORDER_SWITCH_RECEIPT_SCHEMA_V1 = "cm.capability-cell/profile-switch-receipt/v1";
export const ERP_ORDER_SEMANTICS_V1 = "ERP_ORDER_CREATE_DISCRETE_UNITS_V1";
export const ERP_ORDER_CLAIM_BOUNDARY_V1 = "ADAPTED_LOCAL_SYNTHETIC_TWO_BINDINGS_NETLESS_NO_LIVE_ERP_NO_MIGRATION_NO_ARBITRARY_ACCOUNTING_EQUIVALENCE_NO_L4";
const PROFILE_KEYS = [
    "schemaVersion", "profileId", "profileVersion", "catalogueBinding", "semantics",
    "provider", "runtime", "claimBoundary", "profileDigest",
];
function digest(value) {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function isDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function unsigned(value) {
    const { profileDigest: _ignored, ...rest } = value;
    return rest;
}
export function erpOrderProfileDigestV1(value) {
    return digest(unsigned(value));
}
function profileMaterial(catalogue, kind) {
    const action = catalogue.actions.find((candidate) => candidate.actionId === "erp.order.create");
    if (action === undefined)
        throw new Error("ERP_PROFILE_CATALOGUE_BINDING_DENIED");
    const common = {
        schemaVersion: ERP_ORDER_PROFILE_SCHEMA_V1,
        profileVersion: "1.0.0",
        catalogueBinding: {
            actionId: "erp.order.create",
            actionVersion: "1.0.0",
            actionDigest: action.digest,
        },
        semantics: {
            semanticId: ERP_ORDER_SEMANTICS_V1,
            quantityMeaning: "DISCRETE_UNITS",
            unit: "EACH",
            effectLifecycle: "CREATE_READBACK_COMPENSATING_DELETE",
            readback: "AUTHORITATIVE_LOCAL_PROVIDER_STATE",
        },
        runtime: {
            network: "DISABLED",
            storage: "SYNTHETIC_MEMORY_ONLY",
            activationAuthority: false,
            externalCalls: false,
        },
        claimBoundary: ERP_ORDER_CLAIM_BOUNDARY_V1,
    };
    if (kind === "SYNTHETIC_LEDGER_A") {
        return {
            ...common,
            profileId: "erp-order:synthetic-ledger-a",
            provider: {
                kind,
                bindingId: "binding:synthetic-ledger-a-v1",
                requestSchema: { type: "object", required: ["articleCode", "clientRequest", "units"], additionalProperties: false },
                responseSchema: { type: "object", required: ["salesOrderNumber"], additionalProperties: false },
                mapping: { skuPath: "articleCode", quantityPath: "units", requestIdPath: "clientRequest", orderIdPath: "salesOrderNumber" },
                effectiveRights: ["sales-order.create", "sales-order.delete-rollback", "sales-order.readback"],
            },
        };
    }
    return {
        ...common,
        profileId: "erp-order:synthetic-commerce-b",
        provider: {
            kind,
            bindingId: "binding:synthetic-commerce-b-v1",
            requestSchema: { type: "object", required: ["idempotencyRef", "line"], additionalProperties: false, lineRequired: ["amount", "item"] },
            responseSchema: { type: "object", required: ["orderKey"], additionalProperties: false },
            mapping: { skuPath: "line.item", quantityPath: "line.amount", requestIdPath: "idempotencyRef", orderIdPath: "orderKey" },
            effectiveRights: ["order.cancel-rollback", "order.create", "order.readback"],
        },
    };
}
export function syntheticErpOrderProfilesV1(catalogue = syntheticCapabilityCatalogueV1()) {
    verifyCapabilityCatalogueV1(catalogue);
    const make = (kind) => {
        const core = profileMaterial(catalogue, kind);
        return { ...core, profileDigest: digest(core) };
    };
    return [make("SYNTHETIC_LEDGER_A"), make("SYNTHETIC_COMMERCE_B")];
}
export function evaluateErpOrderProfileV1(value, catalogue = syntheticCapabilityCatalogueV1()) {
    if (!exactKeys(value, PROFILE_KEYS)
        || value.schemaVersion !== ERP_ORDER_PROFILE_SCHEMA_V1
        || value.profileVersion !== "1.0.0"
        || value.claimBoundary !== ERP_ORDER_CLAIM_BOUNDARY_V1
        || !isDigest(value.profileDigest)
        || !exactKeys(value.catalogueBinding, ["actionId", "actionVersion", "actionDigest"])
        || !exactKeys(value.semantics, ["semanticId", "quantityMeaning", "unit", "effectLifecycle", "readback"])
        || !exactKeys(value.provider, ["kind", "bindingId", "requestSchema", "responseSchema", "mapping", "effectiveRights"])
        || !exactKeys(value.runtime, ["network", "storage", "activationAuthority", "externalCalls"])) {
        return { outcome: "DENIED", reason: "ERP_PROFILE_SCHEMA_DENIED" };
    }
    const candidate = value;
    if (erpOrderProfileDigestV1(candidate) !== candidate.profileDigest) {
        return { outcome: "DENIED", reason: "ERP_PROFILE_DIGEST_DENIED" };
    }
    let verified;
    try {
        verified = verifyCapabilityCatalogueV1(catalogue);
    }
    catch {
        return { outcome: "DENIED", reason: "ERP_PROFILE_CATALOGUE_BINDING_DENIED" };
    }
    const action = verified.actions.find(({ actionId }) => actionId === "erp.order.create");
    if (action === undefined || candidate.catalogueBinding.actionId !== action.actionId
        || candidate.catalogueBinding.actionVersion !== action.version
        || candidate.catalogueBinding.actionDigest !== action.digest) {
        return { outcome: "DENIED", reason: "ERP_PROFILE_CATALOGUE_BINDING_DENIED" };
    }
    const expectedKinds = ["SYNTHETIC_LEDGER_A", "SYNTHETIC_COMMERCE_B"];
    if (!expectedKinds.includes(candidate.provider.kind)
        || candidate.semantics.semanticId !== ERP_ORDER_SEMANTICS_V1
        || candidate.semantics.quantityMeaning !== "DISCRETE_UNITS"
        || candidate.semantics.unit !== "EACH"
        || candidate.semantics.effectLifecycle !== "CREATE_READBACK_COMPENSATING_DELETE"
        || candidate.semantics.readback !== "AUTHORITATIVE_LOCAL_PROVIDER_STATE"
        || candidate.runtime.network !== "DISABLED"
        || candidate.runtime.storage !== "SYNTHETIC_MEMORY_ONLY"
        || candidate.runtime.activationAuthority !== false
        || candidate.runtime.externalCalls !== false) {
        return { outcome: "DENIED", reason: "ERP_PROFILE_INCOMPATIBLE_SEMANTICS_DENIED" };
    }
    const expected = profileMaterial(verified, candidate.provider.kind);
    if (canonicalJson(unsigned(candidate)) !== canonicalJson(expected)) {
        return { outcome: "DENIED", reason: "ERP_PROFILE_SCHEMA_DENIED" };
    }
    return { outcome: "CONFORMANT" };
}
function setPath(target, path, value) {
    const parts = path.split(".");
    const leaf = parts.pop();
    if (leaf === undefined)
        throw new Error("ERP_PROFILE_SCHEMA_DENIED");
    let cursor = target;
    for (const part of parts) {
        const next = {};
        cursor[part] = next;
        cursor = next;
    }
    cursor[leaf] = value;
}
function rightsDiff(from, to) {
    const left = new Set(from.provider.effectiveRights);
    const right = new Set(to.provider.effectiveRights);
    return {
        removed: [...left].filter((item) => !right.has(item)).sort(),
        added: [...right].filter((item) => !left.has(item)).sort(),
        retained: [...left].filter((item) => right.has(item)).sort(),
    };
}
export function erpOrderConsumerV1(core, request) {
    return core.execute(request);
}
export class ErpOrderCapabilityCellV1 {
    coreId = "CAP-CELL-ERP-01-CORE-V1";
    consumerContract = "erp.order.create/v1";
    #catalogue;
    #profiles = new Map();
    #providerOrders = new Map();
    #replay = new Set();
    #receipts = new Map();
    #lkgProfileDigest;
    #activeProfileDigest;
    #executions = 0;
    #replayDenials = 0;
    #profileSwitches = 0;
    #profileRollbacks = 0;
    constructor(options) {
        this.#catalogue = verifyCapabilityCatalogueV1(options.catalogue ?? syntheticCapabilityCatalogueV1());
        if (options.profiles.length !== 2)
            throw new Error("ERP_PROFILE_SET_DENIED");
        for (const profile of options.profiles) {
            const verdict = evaluateErpOrderProfileV1(profile, this.#catalogue);
            if (verdict.outcome !== "CONFORMANT")
                throw new Error(verdict.reason);
            if (this.#profiles.has(profile.profileDigest))
                throw new Error("ERP_PROFILE_SET_DENIED");
            this.#profiles.set(profile.profileDigest, structuredClone(profile));
            this.#providerOrders.set(profile.provider.bindingId, new Map());
        }
        if (!this.#profiles.has(options.activeProfileDigest))
            throw new Error("ERP_PROFILE_EXACT_SWITCH_DENIED");
        this.#activeProfileDigest = options.activeProfileDigest;
        this.#lkgProfileDigest = options.activeProfileDigest;
    }
    execute(request) {
        if (!exactKeys(request, ["requestId", "sku", "quantity"])
            || typeof request.requestId !== "string" || !/^request:erp-cell-[a-z0-9-]{3,64}$/.test(request.requestId)
            || typeof request.sku !== "string" || !/^SYN-[A-Z0-9-]{3,28}$/.test(request.sku)
            || !Number.isSafeInteger(request.quantity) || request.quantity < 1 || request.quantity > 100) {
            throw new Error("ERP_ORDER_REQUEST_DENIED");
        }
        if (this.#replay.has(request.requestId)) {
            this.#replayDenials += 1;
            throw new Error("ERP_ORDER_REPLAY_DENIED");
        }
        this.#replay.add(request.requestId);
        const profile = this.#profiles.get(this.#activeProfileDigest);
        if (profile === undefined)
            throw new Error("ERP_PROFILE_EXACT_SWITCH_DENIED");
        const verdict = evaluateErpOrderProfileV1(profile, this.#catalogue);
        if (verdict.outcome !== "CONFORMANT")
            throw new Error(verdict.reason);
        const orders = this.#providerOrders.get(profile.provider.bindingId);
        if (orders === undefined)
            throw new Error("ERP_PROVIDER_BINDING_DENIED");
        const beforeDigest = digest([...orders.entries()]);
        const providerRequest = {};
        setPath(providerRequest, profile.provider.mapping.skuPath, request.sku);
        setPath(providerRequest, profile.provider.mapping.quantityPath, request.quantity);
        setPath(providerRequest, profile.provider.mapping.requestIdPath, request.requestId);
        const orderId = `synthetic-order-${digest({ profileDigest: profile.profileDigest, request }).slice(0, 12)}`;
        orders.set(orderId, structuredClone(providerRequest));
        const mutationDigest = digest([...orders.entries()]);
        const readback = orders.get(orderId);
        if (readback === undefined || digest(readback) !== digest(providerRequest)) {
            orders.delete(orderId);
            throw new Error("ERP_ORDER_READBACK_DENIED");
        }
        const providerResponse = {};
        setPath(providerResponse, profile.provider.mapping.orderIdPath, orderId);
        const readbackDigest = digest({ providerRequest: readback, providerResponse });
        orders.delete(orderId);
        const finalDigest = digest([...orders.entries()]);
        if (finalDigest !== beforeDigest)
            throw new Error("ERP_ORDER_ROLLBACK_DENIED");
        const core = {
            schemaVersion: ERP_ORDER_RECEIPT_SCHEMA_V1,
            outcome: "SYNTHETIC_ORDER_READBACK_AND_ROLLBACK_VERIFIED",
            actionId: "erp.order.create",
            actionVersion: "1.0.0",
            profileId: profile.profileId,
            profileDigest: profile.profileDigest,
            bindingId: profile.provider.bindingId,
            requestIdDigest: digest(request.requestId),
            requestDigest: digest(request),
            providerRequestDigest: digest(providerRequest),
            orderId,
            readbackDigest,
            beforeDigest,
            mutationDigest,
            finalDigest,
            effectCount: 1,
            rollbackCount: 1,
        };
        const receipt = { ...core, receiptDigest: digest(core) };
        this.#receipts.set(request.requestId, receipt);
        this.#executions += 1;
        return receipt;
    }
    switchProfile(fromProfileDigest, toProfileDigest) {
        return this.#switch(fromProfileDigest, toProfileDigest, "EXACT_PROFILE_SWITCHED");
    }
    rollbackProfile(switchReceipt) {
        if (!exactKeys(switchReceipt, [
            "schemaVersion", "outcome", "fromProfileDigest", "toProfileDigest", "unchangedAction",
            "unchangedSemantics", "rightsDiff", "switchDigest",
        ]) || !exactKeys(switchReceipt.rightsDiff, ["removed", "added", "retained"])) {
            throw new Error("ERP_PROFILE_ROLLBACK_DENIED");
        }
        const { switchDigest, ...switchCore } = switchReceipt;
        const from = this.#profiles.get(switchReceipt.fromProfileDigest);
        const to = this.#profiles.get(switchReceipt.toProfileDigest);
        if (switchReceipt.outcome !== "EXACT_PROFILE_SWITCHED"
            || switchReceipt.schemaVersion !== ERP_ORDER_SWITCH_RECEIPT_SCHEMA_V1
            || switchReceipt.unchangedAction !== "erp.order.create"
            || switchReceipt.unchangedSemantics !== ERP_ORDER_SEMANTICS_V1
            || digest(switchCore) !== switchDigest
            || this.#activeProfileDigest !== switchReceipt.toProfileDigest
            || from === undefined || to === undefined
            || canonicalJson(switchReceipt.rightsDiff) !== canonicalJson(rightsDiff(from, to))) {
            throw new Error("ERP_PROFILE_ROLLBACK_DENIED");
        }
        return this.#switch(switchReceipt.toProfileDigest, switchReceipt.fromProfileDigest, "EXACT_PROFILE_ROLLED_BACK");
    }
    #switch(fromProfileDigest, toProfileDigest, outcome) {
        if (this.#activeProfileDigest !== fromProfileDigest || fromProfileDigest === toProfileDigest) {
            throw new Error("ERP_PROFILE_EXACT_SWITCH_DENIED");
        }
        const from = this.#profiles.get(fromProfileDigest);
        const to = this.#profiles.get(toProfileDigest);
        if (from === undefined || to === undefined)
            throw new Error("ERP_PROFILE_EXACT_SWITCH_DENIED");
        const verdict = evaluateErpOrderProfileV1(to, this.#catalogue);
        if (verdict.outcome !== "CONFORMANT")
            throw new Error(verdict.reason);
        if (from.catalogueBinding.actionDigest !== to.catalogueBinding.actionDigest
            || from.semantics.semanticId !== to.semantics.semanticId) {
            throw new Error("ERP_PROFILE_INCOMPATIBLE_SEMANTICS_DENIED");
        }
        if ([...this.#providerOrders.values()].some((orders) => orders.size !== 0)) {
            throw new Error("ERP_PROFILE_RESIDUE_DENIED");
        }
        const core = {
            schemaVersion: ERP_ORDER_SWITCH_RECEIPT_SCHEMA_V1,
            outcome,
            fromProfileDigest,
            toProfileDigest,
            unchangedAction: "erp.order.create",
            unchangedSemantics: ERP_ORDER_SEMANTICS_V1,
            rightsDiff: rightsDiff(from, to),
        };
        this.#activeProfileDigest = toProfileDigest;
        if (outcome === "EXACT_PROFILE_SWITCHED")
            this.#profileSwitches += 1;
        else
            this.#profileRollbacks += 1;
        return { ...core, switchDigest: digest(core) };
    }
    evidence() {
        return {
            coreId: this.coreId,
            consumerContract: this.consumerContract,
            activeProfileDigest: this.#activeProfileDigest,
            lkgProfileDigest: this.#lkgProfileDigest,
            executions: this.#executions,
            replayDenials: this.#replayDenials,
            profileSwitches: this.#profileSwitches,
            profileRollbacks: this.#profileRollbacks,
            receiptDigests: [...this.#receipts.values()].map(({ receiptDigest }) => receiptDigest).sort(),
            providerOrderCount: [...this.#providerOrders.values()].reduce((sum, orders) => sum + orders.size, 0),
        };
    }
    reset() {
        const retainedReceiptDigests = [...this.#receipts.values()].map(({ receiptDigest }) => receiptDigest).sort();
        for (const orders of this.#providerOrders.values())
            orders.clear();
        this.#receipts.clear();
        this.#replay.clear();
        this.#activeProfileDigest = this.#lkgProfileDigest;
        this.#executions = 0;
        this.#replayDenials = 0;
        this.#profileSwitches = 0;
        this.#profileRollbacks = 0;
        return { retainedReceiptDigests, residue: this.evidence() };
    }
}

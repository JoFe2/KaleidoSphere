// Exact existing string values only; immutable typed data, no evaluator/authority/store.
export const browserWorkspaceStringValuesV1 = Object.freeze(["schemaVersion", "button", "DENIED", "revision", "PROFILE_SCHEMA_DENIED", "objectId", "same-origin", "no-store", "tenantId", "VIEW_SCHEMA_DENIED", "section", "length", "NAVIGATION", "pan.erv.information", "regular", "pan.erv", "sessionId", "shell.main", "/workspace/context", "executionAuthorityGranted", "READBACK_RECEIVED", "REGISTERED", "status", "UNKNOWN", "binding", "ERV_NATIVE", "LOADING", "MODULE_VIEW_CONTEXT_RETIRED", "NOTIFICATION_SESSION_DENIED", "pan.erv.route", "pan.erv.view", "application/json", "aria-label", "change", "HUMAN_REVIEW", "invoice-value", "option", "shell.navigation", "STALE_CONTEXT", "TRUSTED_IN_PROCESS_CODE_OWNED_FACTORIES", "UNAVAILABLE", "version", "/workspace/erv", "AVAILABLE", "checkbox", "CURRENCY_MINOR", "Einrichtung und Betriebszustand", "MODULE_VIEW_DENIED", "moduleId", "native-review", "NUMBER", "OUTCOME_UNKNOWN", "pansphaira.browser-plugin/v1", "pansphaira.browser-profile/v1", "PER_FIELD", "select", "shell.routes", "STALE_MODULE_VIEW_RESPONSE", "unknown", "viewId", ".route", "businessEffectProduced", "CATALOG", "CONFIRM", "context", "CONTEXT_OWNER_CLOSED", "contextHandle", "Eingangsrechnungsprüfung", "eventId", "eventRevision", "Gebundene Bestandsanalyse", "HUMAN_NATIVE", "model.reference", "pan.analysis.route", "pan.configuration.route", "pan.erv.action", "pan.setup.route", "pansphaira.workspace-context/claim/v1", "pansphaira.workspace-context/verify/v1", "pansphaira.workspace-data-catalog/v1", "pansphaira.workspace-module-view/delta/v1", "PLUGIN_ROUTE_DENIED", "PLUGIN_SCHEMA_DENIED", "reason", "RESIZE", "REVIEW_STATE", "source", "VIEW_BINDING_DENIED", "visible", "/workspace/analysis", "#/workspace/setup", "Agentenkonfiguration — Entwurf", "analysis", "ANALYSIS_RESULT_CONTEXT_RETIRED", "AP-PAN516-MATCHED-01", "ausgeblendet", "CONFLICT", "CONTEXT_BINDING_DENIED", "CURRENT_CONTEXT", "erv.invoice.currency", "expectedRevision", "expiresAtMs", "fieldId", "fieldset", "instanceId", "legend", "MISSING_DEPENDENCY", "MODULE_VIEW_WRITE_OUTCOME_UNKNOWN", "outcome", "pan.analysis.view", "pan.configuration.view", "pan.setup", "pan.setup.view", "pan.workspace.boundary", "pansphaira.browser-profile-read/v1", "pansphaira.workspace-module-view/v1", "pansphaira.workspace-notifications/", "profile", "RENDERED", "shell.widgets", "STALE_RENDER", ".navigation", "/reconcile", "/workspace/configuration", "Abweichung", "acceptedQuantity", "ACTION", "AGENT_READ", "analysis.read", "angezeigt", "AP-PAN516-PARTIAL-01", "aria-disabled", "aria-expanded", "aria-live", "aria-pressed", "aria-valuetext", "article", "BACKEND_UNAVAILABLE", "bookingAuthorityGranted", "compact", "confirmedCandidateDigest", "content-type", "CONTEXT_BINDING_STALE", "CONTEXT_DISPOSAL_DENIED", "CONTEXT_PENDING_LIMIT", "currency", "CURRENT_CONTEXT_REFRESH_DENIED", "CURRENT_CONTEXT_RESPONSE", "CURRENT_MODULE_VIEW_RESPONSE", "DEFAULT_UNSUPPORTED", "demo.status.read", "details", "DISABLED", "effectsProduced", "Eigenes Mitarbeiterverzeichnis", "Eingangsrechnungsprüfung — nur lesen", "elementId", "entrypoint", "erv.human.reviewState", "erv.invoice.amountMinor", "erv.read", "Erwarteter Betrag", "expectedAmountMinor", "FACTORY_KIND_BINDING_DENIED", "filter", "Gebundene Bestandsanalyse — nur lesen", "GLOBAL_ID_OR_ROUTE_CONFLICT", "Hinweise neu lesen", "HUMAN_DECIDE", "inAppEnabled", "Informationen zum aktuellen Rechnungsvorgang", "invoiceAmountMinor", "invoicedQuantity", "ISO4217", "leadingStore", "LIABILITY_STATE", "mark-read", "NATIVE_VIEW_UNAVAILABLE", "NOT_RECORDED", "NOTIFICATION_PERMISSION_DENIED", "NOTIFICATION_TARGET_RETIRED", "orderedQuantity", "pan.analysis.navigation", "pan.configuration.navigation", "pan.erv.module-card", "pan.erv.navigation", "pan.setup.navigation", "panel-open", "pansphaira.browser-context/v1", "pansphaira.workspace-context/readback/v1", "pansphaira.workspace-context/snapshot/v1", "pansphaira.workspace-context/tab-bootstrap/v1", "pansphaira.workspace-notifications/preferences-write/v1", "paymentOrderAuthorized", "PENDING", "PLUGIN_ID_DENIED", "PLUGIN_VERSION_DENIED", "polite", "preferences", "profile.controls", "profile.editor", "QUANTITY", "READ_CONFIRMED", "read-state", "readOnly", "Rechnung ", "Rechnungsbetrag", "reconcile-read", "reportDigest", "resultRevision", "routeId", "SAVING", "select,input,button", "selection", "SHA-256", "shell.actions", "shell.logout", "shell.notifications", "shell.panels", "snapshot", "SOURCE_SCOPE_CHANGED", "stockRunwayDays", "STRING", "submit", "subscriptions", "summary", "SUPPRESSED", "target", "taskIdentityDigest", "ui.context.read", "Unbekannter Backendfehler", "V0_TO_V1", "VIEW_MANDATORY_DENIED", "VIEW_UNIT_DENIED", "viewDigest", "Zugriff verweigert"]);
// Descriptive browser contract only. Shell-owned factory bindings are code, not
// caller authority. No imports, remote module loading or backend grants occur here.
export const BROWSER_SHELL_PLUGIN_SCHEMA_V1 = "pansphaira.browser-plugin/v1";
export const BROWSER_SHELL_CONTRACT_VERSION_V1 = "1.0.0";
export const BROWSER_SHELL_SLOTS_V1 = {
    NAVIGATION: "shell.navigation", ROUTE: "shell.routes", VIEW: "shell.main",
    WIDGET: "shell.widgets", PANEL: "shell.panels", ACTION: "shell.actions",
};
function record(value, keys) {
    if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
        return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    return actual.length === keys.length && actual.every(key => typeof key === "string" && keys.includes(key))
        && Object.values(descriptors).every(d => d.enumerable && "value" in d);
}
function array(value) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 64)
        return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).length === value.length + 1
        && Array.from({ length: value.length }, (_, i) => descriptors[String(i)])
            .every(d => d !== undefined && d.enumerable && "value" in d);
}
const identifier = (value) => typeof value === "string" && /^[a-z][a-z0-9.-]{2,79}$/.test(value);
const version = (value) => typeof value === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
const strings = (value) => array(value) && value.every(identifier) && new Set(value).size === value.length;
function frozen(value) {
    if (value !== null && typeof value === "object") {
        Object.values(value).forEach(frozen);
        Object.freeze(value);
    }
    return value;
}
export function validateBrowserShellPluginV1(value, ownedFactoryIds) {
    const denied = (reason) => ({ outcome: browserWorkspaceStringValuesV1[2], reason });
    if (!record(value, [browserWorkspaceStringValuesV1[0], "id", browserWorkspaceStringValuesV1[41], "shellVersion", "enabled", "trustBoundary", "contributions", "needs"])
        || value.schemaVersion !== BROWSER_SHELL_PLUGIN_SCHEMA_V1 || typeof value.enabled !== "boolean"
        || value.trustBoundary !== browserWorkspaceStringValuesV1[39] || !version(value.version)
        || !array(value.contributions) || value.contributions.length === 0)
        return denied(browserWorkspaceStringValuesV1[82]);
    if (value.shellVersion !== BROWSER_SHELL_CONTRACT_VERSION_V1)
        return denied(browserWorkspaceStringValuesV1[196]);
    if (!identifier(value.id) || value.id === "shell" || value.id.startsWith("shell."))
        return denied(browserWorkspaceStringValuesV1[195]);
    if (!record(value.needs, ["data", browserWorkspaceStringValuesV1[64], "rights", "dependencies"]) || !strings(value.needs.data)
        || !strings(value.needs.rights) || !array(value.needs.context) || new Set(value.needs.context).size !== value.needs.context.length
        || !value.needs.context.every(x => [browserWorkspaceStringValuesV1[8], browserWorkspaceStringValuesV1[16], browserWorkspaceStringValuesV1[5], browserWorkspaceStringValuesV1[3]].includes(x))
        || !array(value.needs.dependencies))
        return denied(browserWorkspaceStringValuesV1[82]);
    const dependencies = new Set();
    for (const dependency of value.needs.dependencies) {
        if (!record(dependency, ["id", browserWorkspaceStringValuesV1[41]]) || !identifier(dependency.id) || !version(dependency.version)
            || dependency.id === value.id || dependencies.has(dependency.id))
            return denied(browserWorkspaceStringValuesV1[82]);
        dependencies.add(dependency.id);
    }
    const ids = new Set();
    const routes = new Set();
    const paths = new Set();
    for (const contribution of value.contributions) {
        if (!record(contribution, ["id", "kind", "slot", "factoryId", browserWorkspaceStringValuesV1[210], "path", "label"])
            || typeof contribution.kind !== "string" || !Object.hasOwn(BROWSER_SHELL_SLOTS_V1, contribution.kind)
            || contribution.slot !== BROWSER_SHELL_SLOTS_V1[contribution.kind]
            || typeof contribution.label !== "string" || !contribution.label.trim() || contribution.label.length > 160)
            return denied(browserWorkspaceStringValuesV1[82]);
        if (!identifier(contribution.id) || !contribution.id.startsWith(value.id + ".") || ids.has(contribution.id))
            return denied(browserWorkspaceStringValuesV1[195]);
        ids.add(contribution.id);
        if (contribution.kind === "ROUTE") {
            if (contribution.factoryId !== null || contribution.routeId !== contribution.id || typeof contribution.path !== "string"
                || !/^\/workspace\/[a-z][a-z0-9-]{0,63}$/.test(contribution.path) || paths.has(contribution.path))
                return denied(browserWorkspaceStringValuesV1[81]);
            routes.add(contribution.id);
            paths.add(contribution.path);
        }
        else {
            if (!identifier(contribution.factoryId) || !ownedFactoryIds.has(contribution.factoryId))
                return denied("PLUGIN_FACTORY_DENIED");
            if (contribution.path !== null || !(contribution.routeId === null || identifier(contribution.routeId)))
                return denied(browserWorkspaceStringValuesV1[81]);
        }
    }
    for (const contribution of value.contributions) {
        if ((contribution.kind === browserWorkspaceStringValuesV1[12] || contribution.kind === "VIEW") && contribution.routeId === null)
            return denied(browserWorkspaceStringValuesV1[81]);
        if (contribution.routeId !== null && !routes.has(contribution.routeId))
            return denied(browserWorkspaceStringValuesV1[81]);
    }
    const descriptor = frozen(JSON.parse(JSON.stringify(value)));
    return { outcome: "DESCRIPTOR_VALID", descriptor, grantedRights: Object.freeze([]) };
}

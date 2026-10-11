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
    const denied = (reason) => ({ outcome: "DENIED", reason });
    if (!record(value, ["schemaVersion", "id", "version", "shellVersion", "enabled", "trustBoundary", "contributions", "needs"])
        || value.schemaVersion !== BROWSER_SHELL_PLUGIN_SCHEMA_V1 || typeof value.enabled !== "boolean"
        || value.trustBoundary !== "TRUSTED_IN_PROCESS_CODE_OWNED_FACTORIES" || !version(value.version)
        || !array(value.contributions) || value.contributions.length === 0)
        return denied("PLUGIN_SCHEMA_DENIED");
    if (value.shellVersion !== BROWSER_SHELL_CONTRACT_VERSION_V1)
        return denied("PLUGIN_VERSION_DENIED");
    if (!identifier(value.id) || value.id === "shell" || value.id.startsWith("shell."))
        return denied("PLUGIN_ID_DENIED");
    if (!record(value.needs, ["data", "context", "rights", "dependencies"]) || !strings(value.needs.data)
        || !strings(value.needs.rights) || !array(value.needs.context) || new Set(value.needs.context).size !== value.needs.context.length
        || !value.needs.context.every(x => ["tenantId", "sessionId", "objectId", "revision"].includes(x))
        || !array(value.needs.dependencies))
        return denied("PLUGIN_SCHEMA_DENIED");
    const dependencies = new Set();
    for (const dependency of value.needs.dependencies) {
        if (!record(dependency, ["id", "version"]) || !identifier(dependency.id) || !version(dependency.version)
            || dependency.id === value.id || dependencies.has(dependency.id))
            return denied("PLUGIN_SCHEMA_DENIED");
        dependencies.add(dependency.id);
    }
    const ids = new Set();
    const routes = new Set();
    const paths = new Set();
    for (const contribution of value.contributions) {
        if (!record(contribution, ["id", "kind", "slot", "factoryId", "routeId", "path", "label"])
            || typeof contribution.kind !== "string" || !Object.hasOwn(BROWSER_SHELL_SLOTS_V1, contribution.kind)
            || contribution.slot !== BROWSER_SHELL_SLOTS_V1[contribution.kind]
            || typeof contribution.label !== "string" || !contribution.label.trim() || contribution.label.length > 160)
            return denied("PLUGIN_SCHEMA_DENIED");
        if (!identifier(contribution.id) || !contribution.id.startsWith(value.id + ".") || ids.has(contribution.id))
            return denied("PLUGIN_ID_DENIED");
        ids.add(contribution.id);
        if (contribution.kind === "ROUTE") {
            if (contribution.factoryId !== null || contribution.routeId !== contribution.id || typeof contribution.path !== "string"
                || !/^\/workspace\/[a-z][a-z0-9-]{0,63}$/.test(contribution.path) || paths.has(contribution.path))
                return denied("PLUGIN_ROUTE_DENIED");
            routes.add(contribution.id);
            paths.add(contribution.path);
        }
        else {
            if (!identifier(contribution.factoryId) || !ownedFactoryIds.has(contribution.factoryId))
                return denied("PLUGIN_FACTORY_DENIED");
            if (contribution.path !== null || !(contribution.routeId === null || identifier(contribution.routeId)))
                return denied("PLUGIN_ROUTE_DENIED");
        }
    }
    for (const contribution of value.contributions) {
        if ((contribution.kind === "NAVIGATION" || contribution.kind === "VIEW") && contribution.routeId === null)
            return denied("PLUGIN_ROUTE_DENIED");
        if (contribution.routeId !== null && !routes.has(contribution.routeId))
            return denied("PLUGIN_ROUTE_DENIED");
    }
    const descriptor = frozen(JSON.parse(JSON.stringify(value)));
    return { outcome: "DESCRIPTOR_VALID", descriptor, grantedRights: Object.freeze([]) };
}

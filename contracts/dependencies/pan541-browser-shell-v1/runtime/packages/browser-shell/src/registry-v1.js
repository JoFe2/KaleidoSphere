import { validateBrowserShellPluginV1, } from "../../contracts/src/browser-shell-plugin-v1.js";
// The registry composes only owner-supplied functions. Descriptor metadata does
// not import code, change backend grants, or sandbox trusted in-process code.
export function createBrowserShellRegistryV1(options) {
    const factories = new Map(options.factories);
    const plugins = new Map();
    const lifetimes = new Map();
    let closed = false;
    function ensureOpen() { if (closed)
        throw new Error("SHELL_REGISTRY_CLOSED"); }
    function fault(pluginId, outcome, reason) {
        try {
            options.reportFault(Object.freeze({ pluginId, outcome, reason }));
        }
        catch { /* The diagnostic renderer has no shell-control authority. */ }
    }
    function dispose(lifetime) {
        lifetime.controller.abort();
        try {
            lifetime.dispose?.();
        }
        catch {
            fault(lifetime.pluginId, "DISPOSAL_FAILED", "OWNED_DISPOSAL_FAILED");
        }
    }
    function retireAll() {
        const owned = [...lifetimes.values()];
        lifetimes.clear();
        for (const lifetime of owned)
            dispose(lifetime);
    }
    function status(pluginId) {
        const memo = new Map();
        const visiting = new Set();
        function visit(id) {
            const known = memo.get(id);
            if (known)
                return known;
            const plugin = plugins.get(id);
            if (!plugin)
                return "DENIED";
            if (!plugin.enabled)
                return "DISABLED";
            if (visiting.has(id))
                return "MISSING_DEPENDENCY";
            visiting.add(id);
            let state = "REGISTERED";
            for (const dependency of plugin.needs.dependencies) {
                if (plugins.get(dependency.id)?.version !== dependency.version || visit(dependency.id) !== "REGISTERED") {
                    state = "MISSING_DEPENDENCY";
                    break;
                }
            }
            visiting.delete(id);
            memo.set(id, state);
            return state;
        }
        return Object.freeze({ outcome: visit(pluginId), pluginId });
    }
    return Object.freeze({
        status,
        register(value) {
            ensureOpen();
            const checked = validateBrowserShellPluginV1(value, new Set(factories.keys()));
            if (checked.outcome === "DENIED") {
                fault("unknown", "DENIED", checked.reason);
                return checked;
            }
            const descriptor = checked.descriptor;
            if (descriptor.contributions.some(c => c.kind !== "ROUTE" && factories.get(c.factoryId)?.kind !== c.kind)) {
                fault(descriptor.id, "DENIED", "FACTORY_KIND_BINDING_DENIED");
                return { outcome: "DENIED", reason: "FACTORY_KIND_BINDING_DENIED" };
            }
            const existing = [...plugins.values()].flatMap(p => p.contributions);
            if (plugins.has(descriptor.id) || plugins.size >= 64 || descriptor.contributions.some(c => existing.some(e => e.id === c.id || (c.path !== null && e.path === c.path)))) {
                fault(descriptor.id, "DENIED", "GLOBAL_ID_OR_ROUTE_CONFLICT");
                return { outcome: "DENIED", reason: "GLOBAL_ID_OR_ROUTE_CONFLICT" };
            }
            plugins.set(descriptor.id, descriptor);
            return Object.freeze({ ...status(descriptor.id), grantedRights: Object.freeze([]) });
        },
        routes() {
            return Object.freeze([...plugins.values()].flatMap(plugin => plugin.contributions.filter(c => c.kind === "ROUTE")
                .map(c => Object.freeze({ pluginId: plugin.id, routeId: c.id, path: c.path, label: c.label, state: status(plugin.id).outcome }))));
        },
        async render(contributionId, target) {
            ensureOpen();
            const plugin = [...plugins.values()].find(p => p.contributions.some(c => c.id === contributionId));
            const contribution = plugin?.contributions.find(c => c.id === contributionId);
            if (!plugin || !contribution || contribution.kind === "ROUTE")
                return { outcome: "DENIED", reason: "UNKNOWN_RENDERABLE_ID" };
            const admitted = status(plugin.id);
            if (admitted.outcome !== "REGISTERED")
                return admitted;
            const factory = factories.get(contribution.factoryId);
            if (!factory)
                return { outcome: "DENIED", reason: "FACTORY_NOT_OWNED" };
            const cell = contribution.kind === "VIEW" ? contribution.slot : contribution.id;
            const old = lifetimes.get(cell);
            if (old) {
                lifetimes.delete(cell);
                dispose(old);
            }
            const lifetime = { pluginId: plugin.id, controller: new AbortController() };
            lifetimes.set(cell, lifetime);
            try {
                const cleanup = await factory.render(Object.freeze({ target, contribution, signal: lifetime.controller.signal }));
                if (typeof cleanup === "function")
                    lifetime.dispose = cleanup;
                if (closed || lifetime.controller.signal.aborted || lifetimes.get(cell) !== lifetime) {
                    dispose(lifetime);
                    return { outcome: "STALE_RENDER" };
                }
                return { outcome: "RENDERED", contributionId, grantedRights: Object.freeze([]) };
            }
            catch {
                if (closed || lifetime.controller.signal.aborted || lifetimes.get(cell) !== lifetime) {
                    dispose(lifetime);
                    return { outcome: "STALE_RENDER" };
                }
                lifetimes.delete(cell);
                dispose(lifetime);
                fault(plugin.id, "RENDER_FAILED", "OWNED_RENDERER_FAILED");
                return { outcome: "RENDER_FAILED", pluginId: plugin.id };
            }
        },
        retireAll,
        unregister(pluginId) {
            ensureOpen();
            for (const [cell, lifetime] of lifetimes)
                if (lifetime.pluginId === pluginId) {
                    lifetimes.delete(cell);
                    dispose(lifetime);
                }
            return plugins.delete(pluginId);
        },
        close() { if (closed)
            return; closed = true; retireAll(); plugins.clear(); },
    });
}

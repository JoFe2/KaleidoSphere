import {
  validateBrowserShellPluginV1,
  type BrowserContributionKindV1,
  type BrowserContributionV1,
  type BrowserShellPluginV1,
} from "../../contracts/src/browser-shell-plugin-v1.js";

type RenderableKind = Exclude<BrowserContributionKindV1, "ROUTE">;
export interface BrowserShellRenderFrameV1<Target> {
  readonly target: Target;
  readonly contribution: BrowserContributionV1;
  readonly signal: AbortSignal;
}
export interface BrowserShellFactoryV1<Target> {
  readonly kind: RenderableKind;
  readonly render: (frame: BrowserShellRenderFrameV1<Target>) => void | (() => void) | Promise<void | (() => void)>;
}
export interface BrowserShellFaultV1 {
  readonly pluginId: string;
  readonly outcome: "DENIED" | "RENDER_FAILED" | "DISPOSAL_FAILED";
  readonly reason: string;
}

// The registry composes only owner-supplied functions. Descriptor metadata does
// not import code, change backend grants, or sandbox trusted in-process code.
export function createBrowserShellRegistryV1<Target>(options: {
  readonly factories: ReadonlyMap<string, BrowserShellFactoryV1<Target>>;
  readonly reportFault: (fault: BrowserShellFaultV1) => void;
}) {
  const factories = new Map(options.factories);
  const plugins = new Map<string, BrowserShellPluginV1>();
  type Lifetime = { pluginId: string; controller: AbortController; dispose?: () => void };
  const lifetimes = new Map<string, Lifetime>();
  let closed = false;
  function ensureOpen() { if (closed) throw new Error("SHELL_REGISTRY_CLOSED"); }
  function fault(pluginId: string, outcome: BrowserShellFaultV1["outcome"], reason: string) {
    try { options.reportFault(Object.freeze({ pluginId, outcome, reason })); } catch { /* The diagnostic renderer has no shell-control authority. */ }
  }
  function dispose(lifetime: Lifetime) {
    lifetime.controller.abort();
    try { lifetime.dispose?.(); } catch { fault(lifetime.pluginId, "DISPOSAL_FAILED", "OWNED_DISPOSAL_FAILED"); }
  }
  function retireAll() {
    const owned = [...lifetimes.values()]; lifetimes.clear();
    for (const lifetime of owned) dispose(lifetime);
  }
  function status(pluginId: string): { readonly outcome: "REGISTERED" | "DISABLED" | "MISSING_DEPENDENCY" | "DENIED"; readonly pluginId: string } {
    type State = "REGISTERED" | "DISABLED" | "MISSING_DEPENDENCY" | "DENIED";
    const memo = new Map<string, State>(); const visiting = new Set<string>();
    function visit(id: string): State {
      const known = memo.get(id); if (known) return known;
      const plugin = plugins.get(id);
      if (!plugin) return "DENIED";
      if (!plugin.enabled) return "DISABLED";
      if (visiting.has(id)) return "MISSING_DEPENDENCY";
      visiting.add(id);
      let state: State = "REGISTERED";
      for (const dependency of plugin.needs.dependencies) {
        if (plugins.get(dependency.id)?.version !== dependency.version || visit(dependency.id) !== "REGISTERED") { state = "MISSING_DEPENDENCY"; break; }
      }
      visiting.delete(id); memo.set(id, state); return state;
    }
    return Object.freeze({ outcome: visit(pluginId), pluginId });
  }
  return Object.freeze({
    status,
    register(value: unknown) {
      ensureOpen();
      const checked = validateBrowserShellPluginV1(value, new Set(factories.keys()));
      if (checked.outcome === "DENIED") { fault("unknown", "DENIED", checked.reason); return checked; }
      const descriptor = checked.descriptor;
      if (descriptor.contributions.some(c => c.kind !== "ROUTE" && factories.get(c.factoryId)?.kind !== c.kind)) {
        fault(descriptor.id, "DENIED", "FACTORY_KIND_BINDING_DENIED");
        return { outcome: "DENIED" as const, reason: "FACTORY_KIND_BINDING_DENIED" };
      }
      const existing = [...plugins.values()].flatMap(p => p.contributions);
      if (plugins.has(descriptor.id) || plugins.size >= 64 || descriptor.contributions.some(c => existing.some(e => e.id === c.id || (c.path !== null && e.path === c.path)))) {
        fault(descriptor.id, "DENIED", "GLOBAL_ID_OR_ROUTE_CONFLICT");
        return { outcome: "DENIED" as const, reason: "GLOBAL_ID_OR_ROUTE_CONFLICT" };
      }
      plugins.set(descriptor.id, descriptor);
      return Object.freeze({ ...status(descriptor.id), grantedRights: Object.freeze([]) });
    },
    routes() {
      return Object.freeze([...plugins.values()].flatMap(plugin => plugin.contributions.filter(c => c.kind === "ROUTE")
        .map(c => Object.freeze({ pluginId: plugin.id, routeId: c.id, path: c.path, label: c.label, state: status(plugin.id).outcome }))));
    },
    async render(contributionId: string, target: Target) {
      ensureOpen();
      const plugin = [...plugins.values()].find(p => p.contributions.some(c => c.id === contributionId));
      const contribution = plugin?.contributions.find(c => c.id === contributionId);
      if (!plugin || !contribution || contribution.kind === "ROUTE") return { outcome: "DENIED" as const, reason: "UNKNOWN_RENDERABLE_ID" };
      const admitted = status(plugin.id); if (admitted.outcome !== "REGISTERED") return admitted;
      const factory = factories.get(contribution.factoryId);
      if (!factory) return { outcome: "DENIED" as const, reason: "FACTORY_NOT_OWNED" };
      const cell = contribution.kind === "VIEW" ? contribution.slot : contribution.id;
      const old = lifetimes.get(cell); if (old) { lifetimes.delete(cell); dispose(old); }
      const lifetime: Lifetime = { pluginId: plugin.id, controller: new AbortController() };
      lifetimes.set(cell, lifetime);
      try {
        const cleanup = await factory.render(Object.freeze({ target, contribution, signal: lifetime.controller.signal }));
        if (typeof cleanup === "function") lifetime.dispose = cleanup;
        if (closed || lifetime.controller.signal.aborted || lifetimes.get(cell) !== lifetime) {
          dispose(lifetime); return { outcome: "STALE_RENDER" as const };
        }
        return { outcome: "RENDERED" as const, contributionId, grantedRights: Object.freeze([]) };
      } catch {
        if (closed || lifetime.controller.signal.aborted || lifetimes.get(cell) !== lifetime) {
          dispose(lifetime); return { outcome: "STALE_RENDER" as const };
        }
        lifetimes.delete(cell);
        dispose(lifetime); fault(plugin.id, "RENDER_FAILED", "OWNED_RENDERER_FAILED");
        return { outcome: "RENDER_FAILED" as const, pluginId: plugin.id };
      }
    },
    retireAll,
    unregister(pluginId: string) {
      ensureOpen();
      for (const [cell, lifetime] of lifetimes) if (lifetime.pluginId === pluginId) { lifetimes.delete(cell); dispose(lifetime); }
      return plugins.delete(pluginId);
    },
    close() { if (closed) return; closed = true; retireAll(); plugins.clear(); },
  });
}

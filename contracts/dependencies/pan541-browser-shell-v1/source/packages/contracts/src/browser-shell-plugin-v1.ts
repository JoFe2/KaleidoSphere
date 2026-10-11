// Descriptive browser contract only. Shell-owned factory bindings are code, not
// caller authority. No imports, remote module loading or backend grants occur here.
export const BROWSER_SHELL_PLUGIN_SCHEMA_V1 = "pansphaira.browser-plugin/v1" as const;
export const BROWSER_SHELL_CONTRACT_VERSION_V1 = "1.0.0" as const;
export const BROWSER_SHELL_SLOTS_V1 = {
  NAVIGATION: "shell.navigation", ROUTE: "shell.routes", VIEW: "shell.main",
  WIDGET: "shell.widgets", PANEL: "shell.panels", ACTION: "shell.actions",
} as const;
export type BrowserContributionKindV1 = keyof typeof BROWSER_SHELL_SLOTS_V1;
export type BrowserContributionV1 = {
  [Kind in BrowserContributionKindV1]: {
    readonly id: string;
    readonly kind: Kind;
    readonly slot: typeof BROWSER_SHELL_SLOTS_V1[Kind];
    readonly label: string;
  } & (Kind extends "ROUTE" ? {
    readonly factoryId: null;
    readonly routeId: string;
    readonly path: string;
  } : {
    readonly factoryId: string;
    readonly routeId: Kind extends "NAVIGATION" | "VIEW" ? string : string | null;
    readonly path: null;
  });
}[BrowserContributionKindV1];
export interface BrowserShellPluginV1 {
  readonly schemaVersion: typeof BROWSER_SHELL_PLUGIN_SCHEMA_V1;
  readonly id: string;
  readonly version: string;
  readonly shellVersion: typeof BROWSER_SHELL_CONTRACT_VERSION_V1;
  readonly enabled: boolean;
  readonly trustBoundary: "TRUSTED_IN_PROCESS_CODE_OWNED_FACTORIES";
  readonly contributions: readonly BrowserContributionV1[];
  readonly needs: {
    readonly data: readonly string[];
    readonly context: readonly ("tenantId" | "sessionId" | "objectId" | "revision")[];
    readonly rights: readonly string[];
    readonly dependencies: readonly { readonly id: string; readonly version: string }[];
  };
}
export type BrowserShellPluginValidationV1 =
  | { readonly outcome: "DESCRIPTOR_VALID"; readonly descriptor: BrowserShellPluginV1; readonly grantedRights: readonly [] }
  | { readonly outcome: "DENIED"; readonly reason: "PLUGIN_SCHEMA_DENIED" | "PLUGIN_VERSION_DENIED" | "PLUGIN_FACTORY_DENIED" | "PLUGIN_ID_DENIED" | "PLUGIN_ROUTE_DENIED" };

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  return actual.length === keys.length && actual.every(key => typeof key === "string" && keys.includes(key))
    && Object.values(descriptors).every(d => d.enumerable && "value" in d);
}
function array(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 64) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === value.length + 1
    && Array.from({ length: value.length }, (_, i) => descriptors[String(i)])
      .every(d => d !== undefined && d.enumerable && "value" in d);
}
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9.-]{2,79}$/.test(value);
const version = (value: unknown): value is string => typeof value === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
const strings = (value: unknown): value is string[] => array(value) && value.every(identifier) && new Set(value).size === value.length;
function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

export function validateBrowserShellPluginV1(value: unknown, ownedFactoryIds: ReadonlySet<string>): BrowserShellPluginValidationV1 {
  const denied = (reason: Extract<BrowserShellPluginValidationV1, { outcome: "DENIED" }>["reason"]): BrowserShellPluginValidationV1 => ({ outcome: "DENIED", reason });
  if (!record(value, ["schemaVersion", "id", "version", "shellVersion", "enabled", "trustBoundary", "contributions", "needs"])
    || value.schemaVersion !== BROWSER_SHELL_PLUGIN_SCHEMA_V1 || typeof value.enabled !== "boolean"
    || value.trustBoundary !== "TRUSTED_IN_PROCESS_CODE_OWNED_FACTORIES" || !version(value.version)
    || !array(value.contributions) || value.contributions.length === 0) return denied("PLUGIN_SCHEMA_DENIED");
  if (value.shellVersion !== BROWSER_SHELL_CONTRACT_VERSION_V1) return denied("PLUGIN_VERSION_DENIED");
  if (!identifier(value.id) || value.id === "shell" || value.id.startsWith("shell.")) return denied("PLUGIN_ID_DENIED");
  if (!record(value.needs, ["data", "context", "rights", "dependencies"]) || !strings(value.needs.data)
    || !strings(value.needs.rights) || !array(value.needs.context) || new Set(value.needs.context).size !== value.needs.context.length
    || !value.needs.context.every(x => ["tenantId", "sessionId", "objectId", "revision"].includes(x as string))
    || !array(value.needs.dependencies)) return denied("PLUGIN_SCHEMA_DENIED");
  const dependencies = new Set<string>();
  for (const dependency of value.needs.dependencies) {
    if (!record(dependency, ["id", "version"]) || !identifier(dependency.id) || !version(dependency.version)
      || dependency.id === value.id || dependencies.has(dependency.id)) return denied("PLUGIN_SCHEMA_DENIED");
    dependencies.add(dependency.id);
  }
  const ids = new Set<string>(); const routes = new Set<string>(); const paths = new Set<string>();
  for (const contribution of value.contributions) {
    if (!record(contribution, ["id", "kind", "slot", "factoryId", "routeId", "path", "label"])
      || typeof contribution.kind !== "string" || !Object.hasOwn(BROWSER_SHELL_SLOTS_V1, contribution.kind)
      || contribution.slot !== BROWSER_SHELL_SLOTS_V1[contribution.kind as BrowserContributionKindV1]
      || typeof contribution.label !== "string" || !contribution.label.trim() || contribution.label.length > 160) return denied("PLUGIN_SCHEMA_DENIED");
    if (!identifier(contribution.id) || !contribution.id.startsWith(value.id + ".") || ids.has(contribution.id)) return denied("PLUGIN_ID_DENIED");
    ids.add(contribution.id);
    if (contribution.kind === "ROUTE") {
      if (contribution.factoryId !== null || contribution.routeId !== contribution.id || typeof contribution.path !== "string"
        || !/^\/workspace\/[a-z][a-z0-9-]{0,63}$/.test(contribution.path) || paths.has(contribution.path)) return denied("PLUGIN_ROUTE_DENIED");
      routes.add(contribution.id); paths.add(contribution.path);
    } else {
      if (!identifier(contribution.factoryId) || !ownedFactoryIds.has(contribution.factoryId)) return denied("PLUGIN_FACTORY_DENIED");
      if (contribution.path !== null || !(contribution.routeId === null || identifier(contribution.routeId))) return denied("PLUGIN_ROUTE_DENIED");
    }
  }
  for (const contribution of value.contributions as unknown as BrowserContributionV1[]) {
    if ((contribution.kind === "NAVIGATION" || contribution.kind === "VIEW") && contribution.routeId === null) return denied("PLUGIN_ROUTE_DENIED");
    if (contribution.routeId !== null && !routes.has(contribution.routeId)) return denied("PLUGIN_ROUTE_DENIED");
  }
  const descriptor = frozen(JSON.parse(JSON.stringify(value)) as BrowserShellPluginV1);
  return { outcome: "DESCRIPTOR_VALID", descriptor, grantedRights: Object.freeze([]) };
}

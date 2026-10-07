import type { BrowserContextV1 } from "./context-owner-v1.js";

// Logical binding only, never a credential or backend permission. The backend
// independently checks its current session, tenant, object and native revision.
export interface BrowserDeepLinkV1 {
  readonly path: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly objectId: string | null;
  readonly revision: number | null;
}
const denied = (): never => { throw new Error("DEEP_LINK_DENIED"); };
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{1,95}$/.test(v);
function checked(value: unknown): BrowserDeepLinkV1 {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return denied();
  const ds = Object.getOwnPropertyDescriptors(value); const keys = ["path", "tenantId", "sessionId", "objectId", "revision"];
  if (Reflect.ownKeys(ds).length !== keys.length || Reflect.ownKeys(ds).some(k => typeof k !== "string" || !keys.includes(k))
    || Object.values(ds).some(d => !d.enumerable || !("value" in d))) return denied();
  const v = value as Record<string, unknown>;
  if (typeof v.path !== "string" || !/^\/workspace\/[a-z][a-z0-9-]{0,63}$/.test(v.path) || !id(v.tenantId) || !id(v.sessionId)
    || !((v.objectId === null && v.revision === null) || (id(v.objectId) && Number.isSafeInteger(v.revision) && (v.revision as number) >= 1 && (v.revision as number) <= 999999999))) return denied();
  return Object.freeze({ ...(v as unknown as BrowserDeepLinkV1) });
}
export function buildBrowserDeepLinkV1(value: BrowserDeepLinkV1): string {
  const v = checked(value); const params = new URLSearchParams({ tenantId: v.tenantId, sessionId: v.sessionId });
  if (v.objectId !== null) { params.set("objectId", v.objectId); params.set("revision", String(v.revision)); }
  return "#" + v.path + "?" + params.toString();
}
export function parseBrowserDeepLinkV1(hash: string, context: BrowserContextV1, registeredPaths: readonly string[]): BrowserDeepLinkV1 {
  if (typeof hash !== "string" || hash.length > 1536 || !/^#\/workspace\/[a-z][a-z0-9-]{0,63}(?:\?[^#]*)?$/.test(hash)) return denied();
  const [path, query = ""] = hash.slice(1).split("?");
  if (!path || !registeredPaths.includes(path)) return denied();
  const params = new URLSearchParams(query); const keys = ["tenantId", "sessionId", "objectId", "revision"];
  if ([...params.keys()].some(k => !keys.includes(k) || params.getAll(k).length !== 1)) return denied();
  const revision = params.get("revision");
  if (revision !== null && !/^[1-9][0-9]{0,8}$/.test(revision)) return denied();
  const value = checked({ path, tenantId: params.get("tenantId") ?? context.tenantId, sessionId: params.get("sessionId") ?? context.sessionId,
    objectId: params.get("objectId"), revision: revision === null ? null : Number(revision) });
  if (value.tenantId !== context.tenantId || value.sessionId !== context.sessionId) return denied();
  return value;
}

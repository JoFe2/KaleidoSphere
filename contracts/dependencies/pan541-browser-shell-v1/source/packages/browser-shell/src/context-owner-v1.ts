// Shell-local lifetime and context binding. Backend authentication/effective
// rights stay server-owned; sessionId here is an identity binding, not a token.
export interface BrowserContextV1 {
  readonly schemaVersion: "pansphaira.browser-context/v1";
  readonly tenantId: string;
  readonly sessionId: string;
  readonly objectId: string | null;
  readonly revision: number;
}
export interface BrowserBackendReadbackV1 {
  readonly status: number;
  readonly value: unknown;
}
export type BrowserContextReadV1 =
  | { readonly outcome: "READBACK_RECEIVED"; readonly context: BrowserContextV1; readonly value: unknown; readonly grantedRights: readonly [] }
  | { readonly outcome: "STALE_CONTEXT" | "DENIED" | "BACKEND_UNAVAILABLE"; readonly value: null };

function checkedContext(value: unknown): BrowserContextV1 {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("CONTEXT_BINDING_DENIED");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = ["schemaVersion", "tenantId", "sessionId", "objectId", "revision"];
  if (Reflect.ownKeys(descriptors).length !== keys.length
    || Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !keys.includes(key))
    || Object.values(descriptors).some(d => !d.enumerable || !("value" in d))) throw new Error("CONTEXT_BINDING_DENIED");
  const v = value as Record<string, unknown>;
  const id = (x: unknown) => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{1,95}$/.test(x);
  if (v.schemaVersion !== "pansphaira.browser-context/v1" || !id(v.tenantId) || !id(v.sessionId)
    || !(v.objectId === null || id(v.objectId)) || !Number.isSafeInteger(v.revision) || (v.revision as number) < 1) throw new Error("CONTEXT_BINDING_DENIED");
  return Object.freeze({ schemaVersion: "pansphaira.browser-context/v1", tenantId: v.tenantId as string,
    sessionId: v.sessionId as string, objectId: v.objectId as string | null, revision: v.revision as number });
}

export function createBrowserContextOwnerV1(options: {
  readonly initialContext: BrowserContextV1;
  readonly readBackend: (context: BrowserContextV1, signal: AbortSignal) => Promise<BrowserBackendReadbackV1>;
}) {
  if (!options || typeof options.readBackend !== "function") throw new Error("CONTEXT_BACKEND_OWNER_REQUIRED");
  let current = checkedContext(options.initialContext);
  let epoch = 0; let closed = false;
  const pending = new Set<AbortController>(); const disposals = new Set<() => void>();
  function ensureOpen() { if (closed) throw new Error("CONTEXT_OWNER_CLOSED"); }
  function retire() {
    for (const controller of pending) controller.abort();
    pending.clear();
    const owned = [...disposals]; disposals.clear();
    let failures = 0;
    for (const dispose of owned) { try { dispose(); } catch { failures++; } }
    return Object.freeze({ disposedListeners: owned.length, disposalFailures: failures });
  }
  return Object.freeze({
    context() { return current; },
    onDispose(dispose: () => void) {
      ensureOpen();
      if (typeof dispose !== "function" || disposals.size >= 64) throw new Error("CONTEXT_DISPOSAL_DENIED");
      disposals.add(dispose);
      return () => { disposals.delete(dispose); };
    },
    switchContext(next: unknown) {
      ensureOpen();
      const checked = checkedContext(next);
      if (epoch >= Number.MAX_SAFE_INTEGER) throw new Error("CONTEXT_EPOCH_LIMIT");
      epoch++;
      current = checked;
      return retire();
    },
    async read(): Promise<BrowserContextReadV1> {
      ensureOpen();
      if (pending.size >= 8) throw new Error("CONTEXT_PENDING_LIMIT");
      const requestEpoch = epoch; const binding = current; const controller = new AbortController();
      pending.add(controller);
      try {
        const response = await options.readBackend(binding, controller.signal);
        if (closed || controller.signal.aborted || requestEpoch !== epoch) return { outcome: "STALE_CONTEXT", value: null };
        if (response.status === 401 || response.status === 403) return { outcome: "DENIED", value: null };
        if (response.status !== 200) return { outcome: "BACKEND_UNAVAILABLE", value: null };
        // Receiving JSON is not Ready, mutation completion, permission or a proposal apply.
        return { outcome: "READBACK_RECEIVED", context: binding, value: response.value, grantedRights: Object.freeze([]) };
      } catch {
        return { outcome: closed || controller.signal.aborted || requestEpoch !== epoch ? "STALE_CONTEXT" : "BACKEND_UNAVAILABLE", value: null };
      } finally { pending.delete(controller); }
    },
    close() { if (closed) return; closed = true; epoch++; return retire(); },
  });
}

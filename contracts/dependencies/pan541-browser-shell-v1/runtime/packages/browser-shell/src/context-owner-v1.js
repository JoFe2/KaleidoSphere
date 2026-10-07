function checkedContext(value) {
    if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
        throw new Error("CONTEXT_BINDING_DENIED");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = ["schemaVersion", "tenantId", "sessionId", "objectId", "revision"];
    if (Reflect.ownKeys(descriptors).length !== keys.length
        || Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !keys.includes(key))
        || Object.values(descriptors).some(d => !d.enumerable || !("value" in d)))
        throw new Error("CONTEXT_BINDING_DENIED");
    const v = value;
    const id = (x) => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{1,95}$/.test(x);
    if (v.schemaVersion !== "pansphaira.browser-context/v1" || !id(v.tenantId) || !id(v.sessionId)
        || !(v.objectId === null || id(v.objectId)) || !Number.isSafeInteger(v.revision) || v.revision < 1)
        throw new Error("CONTEXT_BINDING_DENIED");
    return Object.freeze({ schemaVersion: "pansphaira.browser-context/v1", tenantId: v.tenantId,
        sessionId: v.sessionId, objectId: v.objectId, revision: v.revision });
}
export function createBrowserContextOwnerV1(options) {
    if (!options || typeof options.readBackend !== "function")
        throw new Error("CONTEXT_BACKEND_OWNER_REQUIRED");
    let current = checkedContext(options.initialContext);
    let epoch = 0;
    let closed = false;
    const pending = new Set();
    const disposals = new Set();
    function ensureOpen() { if (closed)
        throw new Error("CONTEXT_OWNER_CLOSED"); }
    function retire() {
        for (const controller of pending)
            controller.abort();
        pending.clear();
        const owned = [...disposals];
        disposals.clear();
        let failures = 0;
        for (const dispose of owned) {
            try {
                dispose();
            }
            catch {
                failures++;
            }
        }
        return Object.freeze({ disposedListeners: owned.length, disposalFailures: failures });
    }
    return Object.freeze({
        context() { return current; },
        onDispose(dispose) {
            ensureOpen();
            if (typeof dispose !== "function" || disposals.size >= 64)
                throw new Error("CONTEXT_DISPOSAL_DENIED");
            disposals.add(dispose);
            return () => { disposals.delete(dispose); };
        },
        switchContext(next) {
            ensureOpen();
            const checked = checkedContext(next);
            if (epoch >= Number.MAX_SAFE_INTEGER)
                throw new Error("CONTEXT_EPOCH_LIMIT");
            epoch++;
            current = checked;
            return retire();
        },
        async read() {
            ensureOpen();
            if (pending.size >= 8)
                throw new Error("CONTEXT_PENDING_LIMIT");
            const requestEpoch = epoch;
            const binding = current;
            const controller = new AbortController();
            pending.add(controller);
            try {
                const response = await options.readBackend(binding, controller.signal);
                if (closed || controller.signal.aborted || requestEpoch !== epoch)
                    return { outcome: "STALE_CONTEXT", value: null };
                if (response.status === 401 || response.status === 403)
                    return { outcome: "DENIED", value: null };
                if (response.status !== 200)
                    return { outcome: "BACKEND_UNAVAILABLE", value: null };
                // Receiving JSON is not Ready, mutation completion, permission or a proposal apply.
                return { outcome: "READBACK_RECEIVED", context: binding, value: response.value, grantedRights: Object.freeze([]) };
            }
            catch {
                return { outcome: closed || controller.signal.aborted || requestEpoch !== epoch ? "STALE_CONTEXT" : "BACKEND_UNAVAILABLE", value: null };
            }
            finally {
                pending.delete(controller);
            }
        },
        close() { if (closed)
            return; closed = true; epoch++; return retire(); },
    });
}

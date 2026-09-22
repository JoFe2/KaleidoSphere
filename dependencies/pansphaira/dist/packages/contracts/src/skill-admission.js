import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const SKILL_ADMISSION_SCHEMA_V1 = "chimpmaera.skill/admission-request/v1";
export const SKILL_MANIFEST_SCHEMA_V1 = "chimpmaera.skill/manifest/v1";
export const SKILL_REPORT_SCHEMA_V1 = "chimpmaera.skill/risk-report/v1";
export const SKILL_RECEIPT_SCHEMA_V1 = "chimpmaera.skill/lifecycle-receipt/v1";
const requestKeys = ["correlationId", "files", "manifest", "operationId", "requester", "schemaVersion", "source", "tenant"].sort();
const sourceKeys = ["digest", "kind", "locator", "mutable", "version"].sort();
const manifestKeys = ["access", "dependencies", "displayName", "entrypoint", "format", "id", "licence", "provenance", "requestedCapabilities", "schemaVersion", "tools", "version"].sort();
const accessKeys = ["filesystem", "installScripts", "network", "persistence", "process", "secrets"].sort();
const dependencyKeys = ["digest", "name", "registry", "version"].sort();
const capabilityKeys = ["id", "mode", "reason"].sort();
const fileKeys = ["content", "digest", "kind", "mediaType", "path"].sort();
const toolKeys = ["description", "name"].sort();
const provenanceKeys = ["publisher", "source"].sort();
function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
function digest(value) {
    return sha256(canonicalJson(value));
}
function exactObject(value, keys) {
    return value !== null
        && typeof value === "object"
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype
        && canonicalJson(Object.keys(value).sort()) === canonicalJson(keys);
}
function validId(value, prefix) {
    return typeof value === "string" && new RegExp(`^${prefix}:[a-z0-9][a-z0-9._-]{2,63}$`).test(value);
}
function validVersion(value) {
    return typeof value === "string" && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value);
}
function validDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function validPath(path) {
    return typeof path === "string"
        && path.length >= 1
        && path.length <= 160
        && !path.startsWith("/")
        && !path.includes("\\")
        && !path.split("/").some((part) => part === "" || part === "." || part === "..")
        && /^[A-Za-z0-9._/-]+$/.test(path);
}
export function computeSkillPackageDigestV1(value) {
    return digest({ manifest: value.manifest, files: value.files });
}
export function validateSkillAdmissionRequestV1(value) {
    if (!exactObject(value, requestKeys))
        return { outcome: "DENY", issues: ["SKILL_REQUEST_SCHEMA_DENIED"] };
    if (value.schemaVersion !== SKILL_ADMISSION_SCHEMA_V1
        || !validId(value.operationId, "operation")
        || !validId(value.correlationId, "correlation")
        || !validId(value.tenant, "tenant")
        || !validId(value.requester, "workload")) {
        return { outcome: "DENY", issues: ["SKILL_REQUEST_BINDING_DENIED"] };
    }
    if (!exactObject(value.source, sourceKeys)
        || value.source.kind !== "LOCAL_CONTENT"
        || value.source.mutable !== false
        || !validVersion(value.source.version)
        || !validDigest(value.source.digest)
        || value.source.locator !== `skill+sha256:${value.source.digest}`) {
        return { outcome: "DENY", issues: ["SKILL_SOURCE_IMMUTABILITY_DENIED"] };
    }
    if (!exactObject(value.manifest, manifestKeys))
        return { outcome: "DENY", issues: ["SKILL_MANIFEST_SCHEMA_DENIED"] };
    const manifest = value.manifest;
    if (manifest.schemaVersion !== SKILL_MANIFEST_SCHEMA_V1
        || !validId(manifest.id, "skill")
        || !validVersion(manifest.version)
        || manifest.version !== value.source.version
        || manifest.format !== "OPENCLAW_SKILL"
        || manifest.entrypoint !== "SKILL.md"
        || typeof manifest.displayName !== "string" || manifest.displayName.length < 3 || manifest.displayName.length > 80
        || !["Apache-2.0", "MIT", "BSD-3-Clause", "CC0-1.0"].includes(String(manifest.licence))) {
        return { outcome: "DENY", issues: ["SKILL_MANIFEST_VALUE_DENIED"] };
    }
    if (!exactObject(manifest.provenance, provenanceKeys)
        || !validId(manifest.provenance.publisher, "publisher")
        || typeof manifest.provenance.source !== "string"
        || !/^local:[a-z0-9._/-]{3,100}$/.test(manifest.provenance.source)) {
        return { outcome: "DENY", issues: ["SKILL_PROVENANCE_DENIED"] };
    }
    const access = manifest.access;
    if (!exactObject(access, accessKeys)
        || !["filesystem", "network", "persistence", "process", "secrets"].every((key) => typeof access[key] === "boolean")
        || !Array.isArray(access.installScripts)
        || !access.installScripts.every((script) => typeof script === "string" && script.length <= 120)) {
        return { outcome: "DENY", issues: ["SKILL_ACCESS_DECLARATION_DENIED"] };
    }
    if (!Array.isArray(manifest.dependencies) || manifest.dependencies.length > 32
        || !manifest.dependencies.every((dependency) => exactObject(dependency, dependencyKeys)
            && typeof dependency.name === "string" && /^[a-z0-9][a-z0-9._-]{1,63}$/.test(dependency.name)
            && validVersion(dependency.version) && validDigest(dependency.digest) && dependency.registry === "LOCAL_LOCK")) {
        return { outcome: "DENY", issues: ["SKILL_DEPENDENCY_LOCK_DENIED"] };
    }
    if (!Array.isArray(manifest.requestedCapabilities) || manifest.requestedCapabilities.length > 32
        || !manifest.requestedCapabilities.every((capability) => exactObject(capability, capabilityKeys)
            && validId(capability.id, "capability")
            && ["READ", "WRITE", "EXECUTE"].includes(String(capability.mode))
            && typeof capability.reason === "string" && capability.reason.length >= 3 && capability.reason.length <= 160)) {
        return { outcome: "DENY", issues: ["SKILL_CAPABILITY_DECLARATION_DENIED"] };
    }
    if (!Array.isArray(manifest.tools) || manifest.tools.length > 32
        || !manifest.tools.every((tool) => exactObject(tool, toolKeys)
            && typeof tool.name === "string" && /^[a-z][a-z0-9_.-]{2,63}$/.test(tool.name)
            && typeof tool.description === "string" && tool.description.length >= 3 && tool.description.length <= 240)) {
        return { outcome: "DENY", issues: ["SKILL_TOOL_DECLARATION_DENIED"] };
    }
    if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 64
        || !value.files.every((file) => exactObject(file, fileKeys)
            && validPath(file.path)
            && ["FILE", "SYMLINK"].includes(String(file.kind))
            && ["text/markdown", "application/json", "text/plain"].includes(String(file.mediaType))
            && typeof file.content === "string" && Buffer.byteLength(file.content) <= 128 * 1024
            && validDigest(file.digest) && file.digest === sha256(file.content))) {
        return { outcome: "DENY", issues: ["SKILL_FILE_INTEGRITY_DENIED"] };
    }
    const paths = value.files.map((file) => file.path);
    if (new Set(paths).size !== paths.length || !paths.includes("SKILL.md")) {
        return { outcome: "DENY", issues: ["SKILL_FILE_SET_DENIED"] };
    }
    const request = value;
    const packageDigest = computeSkillPackageDigestV1(request);
    if (packageDigest !== request.source.digest)
        return { outcome: "DENY", issues: ["SKILL_PACKAGE_DIGEST_DENIED"] };
    return { outcome: "ALLOW", request, requestDigest: digest(request), packageDigest };
}
function finding(code, severity, path = null) {
    return { code, severity, path };
}
export function analyseSkillAdmissionV1(request, policy) {
    const findings = [];
    const add = (item) => { findings.push(item); };
    if (request.tenant !== policy.tenant || !policy.requesterIds.includes(request.requester))
        add(finding("SKILL_TENANT_OR_REQUESTER_DENIED", "CRITICAL"));
    if (!policy.publishers.includes(request.manifest.provenance.publisher))
        add(finding("SKILL_PUBLISHER_UNTRUSTED", "HIGH"));
    if (request.manifest.access.installScripts.length > 0)
        add(finding("SKILL_INSTALL_SCRIPT_QUARANTINED", "CRITICAL"));
    for (const key of ["network", "secrets", "process", "persistence", "filesystem"]) {
        if (request.manifest.access[key])
            add(finding(`SKILL_DECLARED_${key.toUpperCase()}_ACCESS`, key === "filesystem" ? "HIGH" : "CRITICAL"));
    }
    const seenDependencies = new Set();
    for (const dependency of request.manifest.dependencies) {
        if (seenDependencies.has(dependency.name))
            add(finding("SKILL_DEPENDENCY_CONFUSION_DENIED", "CRITICAL"));
        seenDependencies.add(dependency.name);
    }
    for (const file of request.files) {
        if (file.kind === "SYMLINK")
            add(finding("SKILL_SYMLINK_DENIED", "CRITICAL", file.path));
        const checks = [
            [/(?:https?:\/\/|fetch\s*\(|XMLHttpRequest|node:https|node:http)/i, "SKILL_HIDDEN_NETWORK_ACCESS", "CRITICAL"],
            [/(?:process\.env|api[_-]?key|access[_-]?token|password|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY)/i, "SKILL_HIDDEN_CREDENTIAL_ACCESS", "CRITICAL"],
            [/(?:child_process|node:child_process|\bexec\s*\(|\bspawn\s*\()/i, "SKILL_HIDDEN_PROCESS_ACCESS", "CRITICAL"],
            [/(?:\.\.\/|\/etc\/|\/proc\/|~\/)/, "SKILL_PATH_ESCAPE_DENIED", "CRITICAL"],
            [/(?:postinstall|preinstall|prepare\s*:)/i, "SKILL_INSTALL_HOOK_INDICATOR", "CRITICAL"],
        ];
        for (const [pattern, code, severity] of checks)
            if (pattern.test(file.content))
                add(finding(code, severity, file.path));
    }
    const transitive = new Set();
    for (const capability of request.manifest.requestedCapabilities) {
        const rights = policy.registeredCapabilities[capability.id];
        if (!rights)
            add(finding("SKILL_UNKNOWN_CAPABILITY_DENIED", "CRITICAL"));
        else
            for (const right of rights)
                transitive.add(right);
        if (rights?.some((right) => right.startsWith("authority:") || right.startsWith("tenant:*"))) {
            add(finding("SKILL_TRANSITIVE_AUTHORITY_ESCALATION", "CRITICAL"));
        }
    }
    const severityWeight = { INFO: 0, LOW: 5, MEDIUM: 15, HIGH: 30, CRITICAL: 100 };
    const riskScore = Math.min(100, findings.reduce((sum, item) => sum + severityWeight[item.severity], 0));
    const verdict = findings.some((item) => item.severity === "CRITICAL")
        ? "QUARANTINE"
        : findings.some((item) => item.severity === "HIGH") || request.manifest.requestedCapabilities.length > 0
            ? "OWNER_REVIEW"
            : "ACCEPTABLE";
    return {
        schemaVersion: SKILL_REPORT_SCHEMA_V1,
        requestDigest: digest(request),
        packageDigest: computeSkillPackageDigestV1(request),
        riskScore,
        qualityScore: Math.max(0, 100 - riskScore),
        findings,
        transitiveCapabilities: [...transitive].sort(),
        verdict,
    };
}
export function decideSkillAdmissionV1(request, report, profile, policy) {
    const requested = request.manifest.requestedCapabilities.map((item) => item.id);
    const capabilityPool = profile === "RAMPAGE" ? policy.rampage.admittedCapabilities : policy.custom.admittedCapabilities;
    const unadmitted = requested.filter((id) => !capabilityPool.includes(id));
    const impacts = [
        `install immutable ${request.manifest.id}@${request.manifest.version}`,
        requested.length === 0 ? "request no capabilities" : `request capabilities without granting: ${requested.join(",")}`,
        "activation remains separate",
    ];
    if (report.verdict === "QUARANTINE")
        return {
            recommendation: "REJECT", route: "QUARANTINE", rationale: report.findings.map((item) => item.code), impacts,
            installAuthorized: false, activationAuthorized: false, grantedCapabilities: [],
        };
    if (unadmitted.length > 0)
        return {
            recommendation: "REJECT", route: "DENY", rationale: unadmitted.map((id) => `SKILL_CAPABILITY_NOT_ADMITTED:${id}`), impacts,
            installAuthorized: false, activationAuthorized: false, grantedCapabilities: [],
        };
    const lowRiskReadOnly = report.verdict === "ACCEPTABLE" && requested.length === 0;
    const hasHighRiskFinding = report.findings.some((item) => item.severity === "HIGH" || item.severity === "CRITICAL");
    const auto = profile === "RAMPAGE"
        ? policy.rampage.ownerAllowsAutoExecution && !hasHighRiskFinding
        : profile === "CUSTOM"
            ? policy.custom.autoApproveLowRiskReadOnly && lowRiskReadOnly
            : lowRiskReadOnly;
    return {
        recommendation: auto ? "ADMIT" : "REVIEW",
        route: auto ? "AUTO_ALLOW" : "OWNER_CONFIRM",
        rationale: auto ? [`${profile}_OWNER_MATRIX_AUTO_ADMISSION`] : [`${profile}_OWNER_CONFIRMATION_REQUIRED`],
        impacts,
        installAuthorized: auto,
        activationAuthorized: false,
        grantedCapabilities: [],
    };
}
export function materializeSkillV1(request, target) {
    const packageDigest = computeSkillPackageDigestV1(request);
    if (target !== "OPENCLAW") {
        return {
            target,
            outcome: "UNPROVEN",
            packageDigest,
            files: [],
            issues: [`${target}_PINNED_FORMAT_AND_RUNTIME_UNPROVEN`],
        };
    }
    return {
        target,
        outcome: "MATERIALIZED",
        packageDigest,
        files: request.files.map((file) => ({ path: file.path, content: file.content, digest: file.digest })),
        issues: [],
    };
}
function deniedDecision(issue, route = "DENY") {
    return { recommendation: "REJECT", route, rationale: [issue], impacts: [], installAuthorized: false, activationAuthorized: false, grantedCapabilities: [] };
}
export class ManagedSkillStoreV1 {
    #generations = new Map();
    #history = new Map();
    #record(tenant, state) {
        const history = this.#history.get(tenant) ?? new Map();
        history.set(state.generation, { generation: state.generation, skills: new Map(state.skills) });
        this.#history.set(tenant, history);
        this.#generations.set(tenant, state);
    }
    snapshot(tenant) {
        const state = this.#generations.get(tenant) ?? { generation: 0, skills: new Map() };
        return { generation: state.generation, skills: [...state.skills.values()].sort((a, b) => a.id.localeCompare(b.id)) };
    }
    commitInstall(tenant, skill) {
        const state = this.#generations.get(tenant) ?? { generation: 0, skills: new Map() };
        this.#record(tenant, state);
        const next = new Map(state.skills);
        next.set(skill.id, skill);
        this.#record(tenant, { generation: state.generation + 1, skills: next });
        return { before: state.generation, after: state.generation + 1 };
    }
    setActive(tenant, skillId, active) {
        const state = this.#generations.get(tenant);
        const skill = state?.skills.get(skillId);
        if (!state || !skill)
            return null;
        const next = new Map(state.skills);
        next.set(skillId, { ...skill, active });
        this.#record(tenant, { generation: state.generation + 1, skills: next });
        return { before: state, after: state.generation + 1 };
    }
    restore(tenant, prior) {
        const current = this.#generations.get(tenant)?.generation ?? 0;
        this.#record(tenant, { generation: current + 1, skills: new Map(prior.skills) });
        return current + 1;
    }
    restorePrevious(tenant) {
        const current = this.#generations.get(tenant);
        const prior = current === undefined ? undefined : this.#history.get(tenant)?.get(current.generation - 1);
        if (!current || !prior)
            return null;
        const after = this.restore(tenant, prior);
        return { before: current.generation, after };
    }
}
export class SkillLifecycleBrokerV1 {
    policy;
    store;
    #busy = new Set();
    #receipts = new Map();
    constructor(policy, store = new ManagedSkillStoreV1()) {
        this.policy = policy;
        this.store = store;
    }
    async install(value, profile, ownerDecision, beforeCommit) {
        const validated = validateSkillAdmissionRequestV1(value);
        const candidate = value;
        const operationId = typeof candidate.operationId === "string" ? candidate.operationId : "operation:invalid";
        const tenant = typeof candidate.tenant === "string" ? candidate.tenant : "tenant:invalid";
        const requestDigest = digest(value);
        const existing = this.#receipts.get(operationId);
        if (existing) {
            if (existing.requestDigest === requestDigest)
                return { ...existing.result, replay: "SAME_RECEIPT" };
            return this.#deny(operationId, tenant, requestDigest, "0".repeat(64), "SKILL_REPLAY_CONFLICT_DENIED");
        }
        if (validated.outcome === "DENY")
            return this.#deny(operationId, tenant, requestDigest, "0".repeat(64), validated.issues[0] ?? "SKILL_DENIED");
        const { request, packageDigest } = validated;
        if (this.#busy.has(request.tenant))
            return this.#deny(request.operationId, request.tenant, validated.requestDigest, packageDigest, "SKILL_CONCURRENT_INSTALL_THROTTLED", "OWNER_CONFIRM", "THROTTLED");
        this.#busy.add(request.tenant);
        try {
            const report = analyseSkillAdmissionV1(request, this.policy);
            let decision = decideSkillAdmissionV1(request, report, profile, this.policy);
            if (decision.route === "OWNER_CONFIRM") {
                const validOwner = ownerDecision?.decision === "APPROVE_INSTALL"
                    && /^owner:[a-z0-9][a-z0-9._-]{2,63}$/.test(ownerDecision.approvedBy)
                    && ownerDecision.tenant === request.tenant
                    && ownerDecision.requestDigest === report.requestDigest
                    && ownerDecision.packageDigest === report.packageDigest;
                if (!validOwner)
                    return this.#deny(request.operationId, request.tenant, report.requestDigest, report.packageDigest, "SKILL_OWNER_DECISION_REQUIRED", "OWNER_CONFIRM");
                decision = { ...decision, recommendation: "ADMIT", installAuthorized: true, rationale: [...decision.rationale, "DIGEST_BOUND_OWNER_INSTALL_APPROVAL"] };
            }
            if (!decision.installAuthorized)
                return this.#deny(request.operationId, request.tenant, report.requestDigest, report.packageDigest, decision.rationale[0] ?? "SKILL_DENIED", decision.route, report.verdict === "QUARANTINE" ? "QUARANTINED" : "DENIED", report, decision);
            await beforeCommit?.();
            const generation = this.store.commitInstall(request.tenant, {
                id: request.manifest.id,
                version: request.manifest.version,
                packageDigest,
                format: request.manifest.format,
                installed: true,
                active: false,
                requestedCapabilities: request.manifest.requestedCapabilities.map((item) => item.id),
                grantedCapabilities: [],
                capabilityLimited: request.manifest.requestedCapabilities.length > 0,
            });
            const receipt = {
                schemaVersion: SKILL_RECEIPT_SCHEMA_V1, operationId: request.operationId, tenant: request.tenant,
                action: "INSTALL", outcome: "COMMITTED", requestDigest: report.requestDigest, packageDigest,
                generationBefore: generation.before, generationAfter: generation.after, route: decision.route, issues: [],
            };
            const result = { outcome: "COMMITTED", decision, report, receipt, replay: "FIRST" };
            this.#receipts.set(request.operationId, { requestDigest: report.requestDigest, result });
            return result;
        }
        finally {
            this.#busy.delete(request.tenant);
        }
    }
    async activate(tenant, skillId, operationId, activationProbe) {
        const snapshot = this.store.snapshot(tenant);
        const skill = snapshot.skills.find((item) => item.id === skillId);
        if (!skill || !validId(operationId, "operation"))
            return this.#simpleReceipt(operationId, tenant, "ACTIVATE", "DENIED", snapshot.generation, snapshot.generation, "0".repeat(64), "SKILL_ACTIVATION_TARGET_DENIED");
        const changed = this.store.setActive(tenant, skillId, true);
        if (!changed)
            return this.#simpleReceipt(operationId, tenant, "ACTIVATE", "DENIED", snapshot.generation, snapshot.generation, skill.packageDigest, "SKILL_ACTIVATION_TARGET_DENIED");
        if (!await activationProbe({ ...skill, active: true })) {
            const restored = this.store.restore(tenant, changed.before);
            return this.#simpleReceipt(operationId, tenant, "ROLLBACK", "ROLLED_BACK", changed.after, restored, skill.packageDigest, "SKILL_ACTIVATION_FAILED_ROLLED_BACK");
        }
        return this.#simpleReceipt(operationId, tenant, "ACTIVATE", "COMMITTED", snapshot.generation, changed.after, skill.packageDigest);
    }
    rollback(tenant, skillId, operationId) {
        const snapshot = this.store.snapshot(tenant);
        const skill = snapshot.skills.find((item) => item.id === skillId);
        if (!skill)
            return this.#simpleReceipt(operationId, tenant, "ROLLBACK", "DENIED", snapshot.generation, snapshot.generation, "0".repeat(64), "SKILL_ROLLBACK_TARGET_DENIED");
        const restored = this.store.restorePrevious(tenant);
        if (!restored)
            return this.#simpleReceipt(operationId, tenant, "ROLLBACK", "DENIED", snapshot.generation, snapshot.generation, skill.packageDigest, "SKILL_PRIOR_GENERATION_NOT_FOUND");
        return this.#simpleReceipt(operationId, tenant, "ROLLBACK", "ROLLED_BACK", restored.before, restored.after, skill.packageDigest);
    }
    #deny(operationId, tenant, requestDigest, packageDigest, issue, route = "DENY", outcome = "DENIED", report = null, decision = deniedDecision(issue, route)) {
        const generation = this.store.snapshot(tenant).generation;
        return {
            outcome, decision, report, replay: "NONE",
            receipt: this.#simpleReceipt(operationId, tenant, "DENY", outcome, generation, generation, packageDigest, issue, requestDigest, route),
        };
    }
    #simpleReceipt(operationId, tenant, action, outcome, before, after, packageDigest, issue, requestDigest = "0".repeat(64), route = "AUTO_ALLOW") {
        return {
            schemaVersion: SKILL_RECEIPT_SCHEMA_V1, operationId, tenant, action, outcome,
            requestDigest, packageDigest, generationBefore: before, generationAfter: after, route,
            issues: issue ? [issue] : [],
        };
    }
}
export function syntheticSkillPolicyV1() {
    return {
        tenant: "tenant:panskys-zoo",
        requesterIds: ["workload:openclaw-agent"],
        publishers: ["publisher:chimpmaera-fixture"],
        registeredCapabilities: {
            "capability:documents.read": ["documents:read"],
            "capability:contacts.write": ["contacts:read", "contacts:write"],
            "capability:authority.admin": ["authority:owner", "tenant:*"]
        },
        custom: { autoApproveLowRiskReadOnly: false, admittedCapabilities: ["capability:documents.read"] },
        rampage: { ownerAllowsAutoExecution: true, admittedCapabilities: ["capability:documents.read", "capability:contacts.write"] },
    };
}
export function syntheticSkillRequestV1(overrides = {}) {
    const files = (overrides.files ?? [{ path: "SKILL.md", kind: "FILE", mediaType: "text/markdown", content: "# Zoo Greeter\n\nReturn the deterministic greeting `Hello from the Zoo`.\n" }])
        .map((file) => ({ ...file, digest: sha256(file.content) }));
    const manifest = {
        schemaVersion: SKILL_MANIFEST_SCHEMA_V1,
        id: "skill:zoo-greeter",
        version: "1.0.0",
        format: "OPENCLAW_SKILL",
        entrypoint: "SKILL.md",
        displayName: "Zoo Greeter",
        licence: "Apache-2.0",
        provenance: { publisher: "publisher:chimpmaera-fixture", source: "local:fixtures/zoo-greeter-1.0.0" },
        access: { filesystem: false, installScripts: [], network: false, persistence: false, process: false, secrets: false, ...overrides.access },
        dependencies: [],
        requestedCapabilities: overrides.capabilities ?? [],
        tools: [],
    };
    const digestValue = computeSkillPackageDigestV1({ manifest, files });
    return {
        schemaVersion: SKILL_ADMISSION_SCHEMA_V1,
        operationId: overrides.operationId ?? "operation:skill-0001",
        correlationId: "correlation:skill-0001",
        tenant: "tenant:panskys-zoo",
        requester: "workload:openclaw-agent",
        source: { kind: "LOCAL_CONTENT", locator: `skill+sha256:${digestValue}`, version: "1.0.0", digest: digestValue, mutable: false },
        manifest,
        files,
    };
}

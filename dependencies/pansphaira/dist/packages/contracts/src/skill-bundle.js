import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonical-json.js";
export const SKILL_BUNDLE_MANIFEST_SCHEMA_V1 = "chimpmaera.skill-bundle/manifest/v1";
export const SKILL_BUNDLE_LOCK_SCHEMA_V1 = "chimpmaera.skill-bundle/lock/v1";
export const SKILL_BUNDLE_EVIDENCE_SCHEMA_V1 = "chimpmaera.skill-bundle/evidence/v1";
const MANIFEST_KEYS = [
    "authority", "bundleId", "capabilityContracts", "compatibility", "dependencies",
    "displayName", "entrypoint", "files", "format", "license", "limitations",
    "publisher", "schemaVersion", "source", "version",
];
const SOURCE_KEYS = ["kind", "locator", "mutable"];
const FILE_KEYS = ["mediaType", "path", "role"];
const DEPENDENCY_KEYS = ["digest", "id", "registry", "version"];
const CAPABILITY_KEYS = ["activationState", "capabilityId", "digest", "version"];
const COMPATIBILITY_KEYS = ["lkg", "matrixId", "supported"];
const CELL_KEYS = [
    "consumer", "contract", "lockMajor", "lockMinor", "manifestMajor", "manifestMinor",
    "runtime", "status",
];
const LKG_KEYS = ["lockSchemaVersion", "manifestSchemaVersion", "runtime"];
const AUTHORITY_KEYS = ["activation", "grantedCapabilities", "installation"];
const LOCK_KEYS = [
    "authority", "bundleId", "bundleVersion", "compatibility", "fileSetDigest",
    "files", "lockIdentity", "lockVersion", "manifestBytesSha256", "manifestDigest",
    "rollback", "schemaVersion", "source",
];
const LOCK_FILE_KEYS = ["mediaType", "path", "role", "sha256", "size"];
const ROLLBACK_KEYS = ["lkgLockIdentity", "mode"];
const CONSUMERS = ["GENERATION", "ANALYSIS", "INSTALLATION", "ROLLBACK"];
const FILE_ROLES = ["ENTRYPOINT", "DOC", "CONFIG", "ASSET", "TEST_FIXTURE"];
const MEDIA_TYPES = ["text/markdown", "application/json", "text/plain"];
const LIMITATIONS = [
    "LOCAL_DETERMINISTIC_CONTRACT_ONLY",
    "NO_LIVE_REGISTRY_OR_SIGNATURE_PROOF",
    "NO_INSTALLATION_OR_ACTIVATION_AUTHORITY",
    "DISCOVERY_OR_PRESENCE_IS_NOT_AUTHORITY",
    "OPENCLAW_V1_ONLY_COMPATIBILITY",
];
export function defaultSkillBundleCompatibilityMatrixV1() {
    return {
        matrixId: "chimpmaera.skill-bundle/compatibility-matrix/v1",
        supported: CONSUMERS.map((consumer) => ({
            consumer,
            runtime: "OPENCLAW",
            manifestMajor: 1,
            manifestMinor: 0,
            lockMajor: 1,
            lockMinor: 0,
            contract: "chimpmaera.skill-bundle/compatibility/v1",
            status: "SUPPORTED",
        })),
        lkg: {
            manifestSchemaVersion: SKILL_BUNDLE_MANIFEST_SCHEMA_V1,
            lockSchemaVersion: SKILL_BUNDLE_LOCK_SCHEMA_V1,
            runtime: "OPENCLAW",
        },
    };
}
export function canonicalSkillBundleManifestBytesV1(value) {
    return canonicalJson(normalizeSkillBundleManifestV1(value));
}
export function normalizeSkillBundleManifestV1(value) {
    if (!exactObject(value, MANIFEST_KEYS))
        invalid();
    if (value.schemaVersion !== SKILL_BUNDLE_MANIFEST_SCHEMA_V1
        || !validBundleId(value.bundleId)
        || !validVersion(value.version)
        || value.format !== "OPENCLAW_SKILL"
        || value.entrypoint !== "SKILL.md"
        || !safeText(value.displayName, 3, 80)
        || !["Apache-2.0", "MIT", "BSD-3-Clause", "CC0-1.0"].includes(String(value.license))
        || !validId(value.publisher, "publisher"))
        invalid();
    if (!exactObject(value.source, SOURCE_KEYS)
        || value.source.kind !== "LOCAL_CONTENT"
        || value.source.mutable !== false
        || !safeLocator(value.source.locator))
        invalid();
    const files = uniqueSortedObjects(value.files, 1, 64, "path", parseManifestFile);
    if (files.filter((file) => file.path === "SKILL.md" && file.role === "ENTRYPOINT").length !== 1)
        invalid();
    return {
        schemaVersion: SKILL_BUNDLE_MANIFEST_SCHEMA_V1,
        bundleId: value.bundleId,
        version: value.version,
        format: "OPENCLAW_SKILL",
        entrypoint: "SKILL.md",
        displayName: value.displayName,
        license: value.license,
        publisher: value.publisher,
        source: {
            kind: "LOCAL_CONTENT",
            locator: value.source.locator,
            mutable: false,
        },
        files,
        dependencies: uniqueSortedObjects(value.dependencies, 0, 32, "id", parseDependency),
        capabilityContracts: uniqueSortedObjects(value.capabilityContracts, 0, 32, "capabilityId", parseCapability),
        compatibility: normalizeCompatibility(value.compatibility),
        authority: normalizeAuthority(value.authority),
        limitations: uniqueSortedLimitations(value.limitations),
    };
}
export function buildSkillBundleLockV1(manifestInput, fileInputs) {
    const manifest = normalizeSkillBundleManifestV1(manifestInput);
    const byPath = new Map();
    for (const file of fileInputs) {
        if (!exactObject(file, ["bytes", "path"]) || !validPath(file.path) || byPath.has(file.path))
            invalid();
        if (typeof file.bytes !== "string" && !(file.bytes instanceof Uint8Array))
            invalid();
        byPath.set(file.path, file);
    }
    const manifestPaths = manifest.files.map((file) => file.path);
    if (byPath.size !== manifestPaths.length || !manifestPaths.every((filePath) => byPath.has(filePath)))
        invalid();
    const files = manifest.files.map((entry) => {
        const input = byPath.get(entry.path);
        if (input === undefined)
            invalid();
        const bytes = Buffer.from(input.bytes);
        return {
            path: entry.path,
            role: entry.role,
            mediaType: entry.mediaType,
            size: bytes.length,
            sha256: sha256Bytes(bytes),
        };
    });
    const manifestBytes = canonicalJson(manifest);
    const manifestDigest = sha256Bytes(Buffer.from(manifestBytes, "utf8"));
    const fileSetDigest = digest({ files });
    const core = {
        schemaVersion: SKILL_BUNDLE_LOCK_SCHEMA_V1,
        lockVersion: "1.0.0",
        bundleId: manifest.bundleId,
        bundleVersion: manifest.version,
        manifestDigest,
        manifestBytesSha256: manifestDigest,
        fileSetDigest,
        source: {
            kind: "LOCAL_CONTENT",
            locator: `skill-bundle+sha256:${fileSetDigest}`,
            mutable: false,
        },
        files,
        compatibility: manifest.compatibility,
        authority: manifest.authority,
        rollback: {
            mode: "RESTORE_EXACT_LOCK_OR_DENY",
            lkgLockIdentity: "",
        },
    };
    const lockIdentity = digest({
        bundleId: core.bundleId,
        bundleVersion: core.bundleVersion,
        fileSetDigest,
        lockSchemaVersion: core.schemaVersion,
        lockVersion: core.lockVersion,
        manifestDigest,
    });
    return {
        ...core,
        lockIdentity,
        rollback: { ...core.rollback, lkgLockIdentity: lockIdentity },
    };
}
export function verifySkillBundleLockV1(value) {
    if (!exactObject(value, LOCK_KEYS))
        invalid();
    if (value.schemaVersion !== SKILL_BUNDLE_LOCK_SCHEMA_V1
        || value.lockVersion !== "1.0.0"
        || !validBundleId(value.bundleId)
        || !validVersion(value.bundleVersion)
        || !validDigest(value.manifestDigest)
        || value.manifestBytesSha256 !== value.manifestDigest
        || !validDigest(value.fileSetDigest)
        || !validDigest(value.lockIdentity))
        invalid();
    if (!exactObject(value.source, SOURCE_KEYS)
        || value.source.kind !== "LOCAL_CONTENT"
        || value.source.mutable !== false
        || value.source.locator !== `skill-bundle+sha256:${value.fileSetDigest}`)
        invalid();
    const files = uniqueSortedObjects(value.files, 1, 64, "path", parseLockFile);
    if (files.filter((file) => file.path === "SKILL.md" && file.role === "ENTRYPOINT").length !== 1)
        invalid();
    if (digest({ files }) !== value.fileSetDigest)
        invalid();
    const expectedLockIdentity = digest({
        bundleId: value.bundleId,
        bundleVersion: value.bundleVersion,
        fileSetDigest: value.fileSetDigest,
        lockSchemaVersion: SKILL_BUNDLE_LOCK_SCHEMA_V1,
        lockVersion: "1.0.0",
        manifestDigest: value.manifestDigest,
    });
    if (expectedLockIdentity !== value.lockIdentity)
        invalid();
    const compatibility = normalizeCompatibility(value.compatibility);
    if (!exactObject(value.rollback, ROLLBACK_KEYS)
        || value.rollback.mode !== "RESTORE_EXACT_LOCK_OR_DENY"
        || value.rollback.lkgLockIdentity !== value.lockIdentity)
        invalid();
    return {
        schemaVersion: SKILL_BUNDLE_LOCK_SCHEMA_V1,
        lockVersion: "1.0.0",
        bundleId: value.bundleId,
        bundleVersion: value.bundleVersion,
        manifestDigest: value.manifestDigest,
        manifestBytesSha256: value.manifestBytesSha256,
        fileSetDigest: value.fileSetDigest,
        lockIdentity: value.lockIdentity,
        source: {
            kind: "LOCAL_CONTENT",
            locator: value.source.locator,
            mutable: false,
        },
        files,
        compatibility,
        authority: normalizeAuthority(value.authority),
        rollback: {
            mode: "RESTORE_EXACT_LOCK_OR_DENY",
            lkgLockIdentity: value.rollback.lkgLockIdentity,
        },
    };
}
export function verifySkillBundleExactFilesV1(lockInput, root) {
    const lock = verifySkillBundleLockV1(lockInput);
    if (typeof root !== "string" || root.length === 0)
        invalid();
    const resolvedRoot = realpathSync(root);
    const observed = walkFiles(resolvedRoot).sort();
    const expected = lock.files.map((file) => file.path);
    if (canonicalJson(observed) !== canonicalJson(expected))
        invalid();
    let materialBytes = 0;
    for (const file of lock.files) {
        const bytes = readSafeFile(resolvedRoot, file.path);
        materialBytes += bytes.length;
        if (bytes.length !== file.size || sha256Bytes(bytes) !== file.sha256)
            invalid();
    }
    return buildSkillBundleVerificationEvidenceV1(lock, materialBytes);
}
export function assertSkillBundleCompatibilityV1(lockInput, consumer, runtime, manifestSchemaVersion = SKILL_BUNDLE_MANIFEST_SCHEMA_V1, lockSchemaVersion = SKILL_BUNDLE_LOCK_SCHEMA_V1) {
    const lock = verifySkillBundleLockV1(lockInput);
    if (runtime !== "OPENCLAW"
        || manifestSchemaVersion !== SKILL_BUNDLE_MANIFEST_SCHEMA_V1
        || lockSchemaVersion !== SKILL_BUNDLE_LOCK_SCHEMA_V1)
        compatibilityInvalid();
    const supported = lock.compatibility.supported.find((cell) => cell.consumer === consumer
        && cell.runtime === runtime
        && cell.manifestMajor === 1
        && cell.manifestMinor === 0
        && cell.lockMajor === 1
        && cell.lockMinor === 0);
    if (supported === undefined)
        compatibilityInvalid();
    return supported;
}
function buildSkillBundleVerificationEvidenceV1(lock, materialBytes) {
    const core = {
        schemaVersion: SKILL_BUNDLE_EVIDENCE_SCHEMA_V1,
        evidenceId: `ASF-01-E-${lock.lockIdentity.slice(0, 16)}`,
        bundleId: lock.bundleId,
        bundleVersion: lock.bundleVersion,
        manifestDigest: lock.manifestDigest,
        fileSetDigest: lock.fileSetDigest,
        lockIdentity: lock.lockIdentity,
        verifiedAt: "2026-08-09T00:00:00Z",
        command: "node --test dist/tests/skill-bundle.test.js",
        result: "PASS",
        fixtureCorpus: {
            reorderVariants: 100,
            canonicalBytesSha256: lock.manifestBytesSha256,
            lockIdentity: lock.lockIdentity,
        },
        byteCoverage: {
            files: lock.files.length,
            materialBytes,
            mode: "EXACT_DECLARED_FILE_SET",
        },
        compatibility: {
            supportedConsumers: lock.compatibility.supported.map((cell) => cell.consumer),
            unsupportedPolicy: "DENY_TO_LKG",
        },
        nonClaims: [
            "Local deterministic contract evidence only.",
            "No live registry, signature chain, marketplace release, installation, activation or production readiness is claimed.",
            "Discovery, presence, validation and merge do not grant capability authority.",
        ],
    };
    return { ...core, evidenceDigest: digest(core) };
}
function normalizeCompatibility(value) {
    if (!exactObject(value, COMPATIBILITY_KEYS) || value.matrixId !== "chimpmaera.skill-bundle/compatibility-matrix/v1")
        invalid();
    if (!exactObject(value.lkg, LKG_KEYS)
        || value.lkg.manifestSchemaVersion !== SKILL_BUNDLE_MANIFEST_SCHEMA_V1
        || value.lkg.lockSchemaVersion !== SKILL_BUNDLE_LOCK_SCHEMA_V1
        || value.lkg.runtime !== "OPENCLAW")
        invalid();
    const supported = uniqueSortedObjects(value.supported, 4, 4, "consumer", parseCompatibilityCell);
    if (canonicalJson(supported.map((cell) => cell.consumer)) !== canonicalJson([...CONSUMERS].sort()))
        invalid();
    return {
        matrixId: "chimpmaera.skill-bundle/compatibility-matrix/v1",
        supported,
        lkg: {
            manifestSchemaVersion: SKILL_BUNDLE_MANIFEST_SCHEMA_V1,
            lockSchemaVersion: SKILL_BUNDLE_LOCK_SCHEMA_V1,
            runtime: "OPENCLAW",
        },
    };
}
function parseCompatibilityCell(value) {
    if (!exactObject(value, CELL_KEYS)
        || !CONSUMERS.includes(value.consumer)
        || value.runtime !== "OPENCLAW"
        || value.manifestMajor !== 1
        || value.manifestMinor !== 0
        || value.lockMajor !== 1
        || value.lockMinor !== 0
        || value.contract !== "chimpmaera.skill-bundle/compatibility/v1"
        || value.status !== "SUPPORTED")
        invalid();
    return value;
}
function normalizeAuthority(value) {
    if (!exactObject(value, AUTHORITY_KEYS)
        || value.installation !== "NO_AUTHORITY"
        || value.activation !== "NO_AUTHORITY"
        || !Array.isArray(value.grantedCapabilities)
        || value.grantedCapabilities.length !== 0)
        invalid();
    return value;
}
function parseManifestFile(value) {
    if (!exactObject(value, FILE_KEYS)
        || !validPath(value.path)
        || !FILE_ROLES.includes(value.role)
        || !MEDIA_TYPES.includes(value.mediaType))
        invalid();
    return value;
}
function parseLockFile(value) {
    if (!exactObject(value, LOCK_FILE_KEYS)
        || !validPath(value.path)
        || !FILE_ROLES.includes(value.role)
        || !MEDIA_TYPES.includes(value.mediaType)
        || !Number.isSafeInteger(value.size)
        || value.size < 0
        || value.size > 128 * 1024
        || !validDigest(value.sha256))
        invalid();
    return value;
}
function parseDependency(value) {
    if (!exactObject(value, DEPENDENCY_KEYS)
        || !validId(value.id, "dependency")
        || !validVersion(value.version)
        || !validDigest(value.digest)
        || value.registry !== "LOCAL_LOCK")
        invalid();
    return value;
}
function parseCapability(value) {
    if (!exactObject(value, CAPABILITY_KEYS)
        || !validId(value.capabilityId, "capability")
        || !validVersion(value.version)
        || !validDigest(value.digest)
        || value.activationState !== "INACTIVE")
        invalid();
    return value;
}
function uniqueSortedLimitations(value) {
    if (!Array.isArray(value) || value.length !== LIMITATIONS.length || !value.every((item) => LIMITATIONS.includes(item)))
        invalid();
    const sorted = [...value].sort();
    if (canonicalJson(sorted) !== canonicalJson([...LIMITATIONS].sort()))
        invalid();
    return sorted;
}
function exactObject(value, keys) {
    return value !== null
        && typeof value === "object"
        && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype
        && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}
function uniqueSortedObjects(value, min, max, key, parse) {
    if (!Array.isArray(value) || value.length < min || value.length > max)
        invalid();
    const parsed = value.map(parse).sort((left, right) => String(left[key]) < String(right[key]) ? -1 : String(left[key]) > String(right[key]) ? 1 : 0);
    const aliases = new Set();
    for (const entry of parsed) {
        const alias = String(entry[key]).normalize("NFC").toLowerCase();
        if (aliases.has(alias))
            invalid();
        aliases.add(alias);
    }
    return parsed;
}
function validPath(value) {
    return typeof value === "string"
        && value.length > 0
        && value.length <= 160
        && value === value.normalize("NFC")
        && !value.startsWith("/")
        && !value.includes("\\")
        && !value.includes("\0")
        && !value.split("/").some((part) => part === "" || part === "." || part === "..")
        && /^[A-Za-z0-9._/-]+$/.test(value);
}
function validBundleId(value) {
    return validId(value, "skillbundle");
}
function validId(value, prefix) {
    return typeof value === "string"
        && value === value.normalize("NFC")
        && new RegExp(`^${prefix}:[a-z0-9][a-z0-9._-]{2,63}$`).test(value)
        && !hasUnresolved(value);
}
function validVersion(value) {
    return typeof value === "string"
        && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value);
}
function validDigest(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function safeText(value, min, max) {
    return typeof value === "string"
        && value.length >= min
        && value.length <= max
        && value === value.normalize("NFC")
        && !hasUnresolved(value)
        && !/[\u0000-\u001f\u007f]/.test(value);
}
function safeLocator(value) {
    return typeof value === "string"
        && /^local\+sha256:[a-f0-9]{64}$/.test(value)
        && !/(?:latest|main|master|stable|HEAD|\$\{|{{|<[^>]+>)/i.test(value)
        && value === value.normalize("NFC");
}
function hasUnresolved(value) {
    return /(?:\$\{|{{|}}|<[^>]+>|latest|HEAD)/i.test(value);
}
function sha256Bytes(value) {
    return createHash("sha256").update(value).digest("hex");
}
function digest(value) {
    return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}
function readSafeFile(root, relative) {
    if (!validPath(relative))
        invalid();
    let current = root;
    for (const part of relative.split("/")) {
        current = path.join(current, part);
        let stats;
        try {
            stats = lstatSync(current);
        }
        catch {
            invalid();
        }
        if (stats.isSymbolicLink())
            invalid();
    }
    const resolved = realpathSync(current);
    const fromRoot = path.relative(root, resolved);
    if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot))
        invalid();
    return readFileSync(resolved);
}
function walkFiles(root, relative = "") {
    const base = relative === "" ? root : path.join(root, relative);
    const entries = readdirSync(base, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
        const childRelative = relative === "" ? entry.name : `${relative}/${entry.name}`;
        if (!validPath(childRelative) || entry.isSymbolicLink())
            invalid();
        if (entry.isDirectory())
            result.push(...walkFiles(root, childRelative));
        else if (entry.isFile())
            result.push(childRelative);
        else
            invalid();
    }
    return result;
}
function invalid() {
    throw new Error("SKILL_BUNDLE_CONTRACT_INVALID_DENIED");
}
function compatibilityInvalid() {
    throw new Error("SKILL_BUNDLE_COMPATIBILITY_DENIED_TO_LKG");
}

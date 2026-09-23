import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
export const EXTENSION_DYNAMIC_CONFIG_SCHEMA_V1 = "chimpmaera.extension-trust/dynamic-synthetic-config/v1";
export const EXTENSION_DYNAMIC_RECEIPT_SCHEMA_V1 = "chimpmaera.extension-trust/dynamic-synthetic-receipt/v1";
export const EXTENSION_DYNAMIC_OBSERVED_SCHEMA_V1 = "chimpmaera.extension-trust/dynamic-synthetic-observed/v1";
export const EXTENSION_DYNAMIC_CLAIM_BOUNDARY_V1 = "LOCAL_SYNTHETIC_DYNAMIC_PROOF_ONLY_NO_CONTAINMENT_CLAIM_NO_THIRD_PARTY_TRUST_NO_ACTIVATION_NO_PRODUCTION";
export const EXTENSION_DYNAMIC_LOCAL_IMAGE_ID_V1 = "sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03";
export const EXTENSION_DYNAMIC_SYNTHETIC_SUBJECT_TREE_DIGEST_V1 = "00f5e0f2a16f744df208888303bc2c07f7c92c31ca8ffefae0a7d5f89d745398";
export const EXTENSION_DYNAMIC_SYNTHETIC_RUNNER_DIGEST_V1 = "08f8f4b696c08edeb2871966a8e62d7af5d6c37283a5a29a95213f9ebe0230c6";
function digest(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
const CONFIG_KEYS = [
    "schemaVersion", "subject", "image", "runnerDigest", "runnerHostPath", "scenario", "timeoutMs", "resources", "scratchHostPath",
];
const SUBJECT_KEYS = ["id", "version", "digest", "hostPath"];
const IMAGE_KEYS = ["name", "id"];
const RESOURCE_KEYS = ["pidsLimit", "memoryBytes", "cpus"];
const OBSERVED_KEYS = ["schemaVersion", "outcome", "exitCode", "timedOut", "cleanup", "readback"];
const CLEANUP_KEYS = ["containerRemoved", "scratchRemoved", "residueCount"];
const READBACK_KEYS = ["preTreeDigest", "postTreeDigest", "egressPolicy"];
const SCENARIOS = ["success", "injected-failure", "timeout"];
const SYNTHETIC_SUBJECT_ROOT = "/tmp/chimpmaera/extension-dynamic/subject";
const SYNTHETIC_RUNNER_ROOT = "/tmp/chimpmaera/extension-dynamic/runner";
const SYNTHETIC_SCRATCH_ROOT = "/tmp/chimpmaera/extension-dynamic";
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function closedKeys(value, keys, path) {
    if (!isRecord(value))
        fail("NOT_OBJECT", `${path} must be a plain JSON object`);
    const present = Object.keys(value).sort();
    const expected = [...keys].sort();
    const unknown = present.filter((key) => !expected.includes(key));
    if (unknown.length > 0)
        fail("UNKNOWN_FIELD", `${path}.${unknown.join(",")}`);
    const missing = expected.filter((key) => !present.includes(key));
    if (missing.length > 0)
        fail("MISSING_FIELD", `${path}.${missing.join(",")}`);
    return value;
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
}
function isHex64(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function isImageId(value) {
    return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}
function isPositiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}
function isPositiveNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function isSafeSyntheticPath(value, root) {
    if (typeof value !== "string" || !value.startsWith(`${root}/`))
        return false;
    if (value !== value.normalize("NFC") || !/^\/[A-Za-z0-9._/-]+$/.test(value))
        return false;
    const parts = value.split("/");
    return !parts.some((part, index) => index > 0 && (part.length === 0 || part === "." || part === ".."));
}
function pathsOverlap(left, right) {
    return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
function fail(code, detail) {
    throw new Error(`EXTENSION_DYNAMIC_${code}: ${detail}`);
}
export function validateExtensionDynamicConfigV1(value) {
    const config = closedKeys(value, CONFIG_KEYS, "config");
    if (config.schemaVersion !== EXTENSION_DYNAMIC_CONFIG_SCHEMA_V1) {
        fail("SCHEMA_VERSION", String(config.schemaVersion));
    }
    const subject = closedKeys(config.subject, SUBJECT_KEYS, "subject");
    if (!isNonEmptyString(subject.id))
        fail("SUBJECT", "id must be a non-empty string");
    if (!isNonEmptyString(subject.version))
        fail("SUBJECT", "version must be a non-empty string");
    if (!isHex64(subject.digest))
        fail("SUBJECT", "digest must be a 64 character lowercase hex string");
    if (!isSafeSyntheticPath(subject.hostPath, SYNTHETIC_SUBJECT_ROOT)) {
        fail("SUBJECT_PATH", `hostPath must be a safe descendant of ${SYNTHETIC_SUBJECT_ROOT}`);
    }
    if (subject.digest !== EXTENSION_DYNAMIC_SYNTHETIC_SUBJECT_TREE_DIGEST_V1) {
        fail("SUBJECT_DIGEST_DRIFT", "subject digest must match the frozen repository-owned subject tree bytes");
    }
    const image = closedKeys(config.image, IMAGE_KEYS, "image");
    if (image.name !== "node:24-bookworm-slim") {
        fail("IMAGE", "name must be the pinned synthetic image");
    }
    if (!isImageId(image.id))
        fail("IMAGE", "id must be a sha256 image digest");
    if (image.id !== EXTENSION_DYNAMIC_LOCAL_IMAGE_ID_V1) {
        fail("IMAGE_ID_DRIFT", "id must match the exact locally pinned image");
    }
    if (!isHex64(config.runnerDigest)) {
        fail("RUNNER_DIGEST", "runnerDigest must be a 64 character lowercase hex string");
    }
    if (config.runnerDigest !== EXTENSION_DYNAMIC_SYNTHETIC_RUNNER_DIGEST_V1) {
        fail("RUNNER_DIGEST_DRIFT", "runnerDigest must match the frozen repository-owned runner bytes");
    }
    if (!isSafeSyntheticPath(config.runnerHostPath, SYNTHETIC_RUNNER_ROOT)) {
        fail("RUNNER_PATH", `runnerHostPath must be a safe descendant of ${SYNTHETIC_RUNNER_ROOT}`);
    }
    if (!SCENARIOS.includes(config.scenario)) {
        fail("SCENARIO", String(config.scenario));
    }
    if (!isPositiveInteger(config.timeoutMs) || config.timeoutMs > 60_000) {
        fail("TIMEOUT", "timeoutMs must be an integer from 1 through 60000");
    }
    const resources = closedKeys(config.resources, RESOURCE_KEYS, "resources");
    if (!isPositiveInteger(resources.pidsLimit) || resources.pidsLimit > 128) {
        fail("RESOURCES", "pidsLimit must be an integer from 1 through 128");
    }
    if (!isPositiveInteger(resources.memoryBytes)
        || resources.memoryBytes < 67_108_864
        || resources.memoryBytes > 1_073_741_824) {
        fail("RESOURCES", "memoryBytes must be from 64 MiB through 1 GiB");
    }
    if (!isPositiveNumber(resources.cpus) || resources.cpus > 1) {
        fail("RESOURCES", "cpus must be greater than zero and no more than one");
    }
    if (!isSafeSyntheticPath(config.scratchHostPath, SYNTHETIC_SCRATCH_ROOT)) {
        fail("SCRATCH_PATH", `scratchHostPath must be a safe descendant of ${SYNTHETIC_SCRATCH_ROOT}`);
    }
    const subjectPath = subject.hostPath;
    const runnerPath = config.runnerHostPath;
    const scratchPath = config.scratchHostPath;
    if (pathsOverlap(subjectPath, runnerPath)
        || pathsOverlap(subjectPath, scratchPath)
        || pathsOverlap(runnerPath, scratchPath)) {
        fail("PATH_OVERLAP", "subject, runner and scratch host paths must be disjoint");
    }
    return config;
}
export function buildExtensionDynamicDockerArgsV1(value) {
    const config = validateExtensionDynamicConfigV1(value);
    return [
        "docker",
        "run",
        "--rm",
        "--pull",
        "never",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--user",
        "1000:1000",
        "--memory",
        String(config.resources.memoryBytes),
        "--memory-swap",
        String(config.resources.memoryBytes),
        "--cpus",
        String(config.resources.cpus),
        "--pids-limit",
        String(config.resources.pidsLimit),
        "-v",
        `${config.subject.hostPath}:/subject:ro`,
        "-v",
        `${config.runnerHostPath}:/runner/runner.js:ro`,
        "-v",
        `${config.scratchHostPath}:/scratch:rw`,
        config.image.id,
        "node",
        "/runner/runner.js",
        "--scenario",
        config.scenario,
        "--timeout-ms",
        String(config.timeoutMs),
    ];
}
function validateObservedV1(value, scenario) {
    const observed = closedKeys(value, OBSERVED_KEYS, "observed");
    if (observed.schemaVersion !== EXTENSION_DYNAMIC_OBSERVED_SCHEMA_V1) {
        fail("OBSERVED_SCHEMA_VERSION", String(observed.schemaVersion));
    }
    const expected = scenario === "success"
        ? { outcome: "SUCCESS", exitCode: 0, timedOut: false }
        : scenario === "injected-failure"
            ? { outcome: "INJECTED_FAILURE", exitCode: 1, timedOut: false }
            : { outcome: "TIMEOUT", exitCode: 124, timedOut: true };
    if (observed.outcome !== expected.outcome)
        fail("OBSERVED_OUTCOME_MISMATCH", String(observed.outcome));
    if (observed.exitCode !== expected.exitCode)
        fail("OBSERVED_EXIT_CODE_MISMATCH", String(observed.exitCode));
    if (observed.timedOut !== expected.timedOut)
        fail("OBSERVED_TIMEOUT_MISMATCH", String(observed.timedOut));
    const cleanup = closedKeys(observed.cleanup, CLEANUP_KEYS, "observed.cleanup");
    if (cleanup.containerRemoved !== true || cleanup.scratchRemoved !== true || cleanup.residueCount !== 0) {
        fail("OBSERVED_CLEANUP", "container and scratch removal with zero residue must be verified");
    }
    const readback = closedKeys(observed.readback, READBACK_KEYS, "observed.readback");
    if (!isHex64(readback.preTreeDigest) || !isHex64(readback.postTreeDigest)) {
        fail("OBSERVED_READBACK", "preTreeDigest and postTreeDigest must be lowercase SHA-256 digests");
    }
    if (readback.egressPolicy !== "NETWORK_NONE")
        fail("OBSERVED_EGRESS", String(readback.egressPolicy));
    return observed;
}
export function buildExtensionDynamicReceiptV1(value, observedValue) {
    const config = validateExtensionDynamicConfigV1(value);
    const observed = observedValue === undefined ? null : validateObservedV1(observedValue, config.scenario);
    const body = {
        schemaVersion: EXTENSION_DYNAMIC_RECEIPT_SCHEMA_V1,
        claimBoundary: EXTENSION_DYNAMIC_CLAIM_BOUNDARY_V1,
        subject: {
            id: config.subject.id,
            version: config.subject.version,
            digest: config.subject.digest,
            hostPath: config.subject.hostPath,
        },
        image: { name: config.image.name, id: config.image.id },
        runnerDigest: config.runnerDigest,
        runnerHostPath: config.runnerHostPath,
        scenario: config.scenario,
        timeoutMs: config.timeoutMs,
        resources: {
            pidsLimit: config.resources.pidsLimit,
            memoryBytes: config.resources.memoryBytes,
            cpus: config.resources.cpus,
        },
        scratchHostPath: config.scratchHostPath,
        execution: observed === null ? "NOT_RUN" : "OBSERVED_LOCAL_SYNTHETIC",
        outcome: observed?.outcome ?? "NOT_RUN",
        exitCode: observed?.exitCode ?? null,
        timedOut: observed?.timedOut ?? null,
        cleanup: observed?.cleanup ?? "NOT_RUN",
        readback: observed?.readback ?? "NOT_RUN",
    };
    return { ...body, receiptDigest: digest(body) };
}

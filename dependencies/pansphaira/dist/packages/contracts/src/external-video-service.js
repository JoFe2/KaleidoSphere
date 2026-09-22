import { createHash } from "node:crypto";
import { isIP } from "node:net";
export const EXTERNAL_VIDEO_SERVICE_CONFIG_SCHEMA_V1 = "chimpmaera.external-video-service/config/v1";
export const EXTERNAL_VIDEO_SERVICE_READBACK_SCHEMA_V1 = "chimpmaera.external-video-service/readback/v1";
export const EXTERNAL_VIDEO_SERVICE_MIN_PRODUCT_VERSION_V1 = "2026.08.02-v2";
export const EXTERNAL_VIDEO_SERVICE_MIN_CONTRACT_VERSION_V1 = "cm.video/v1";
export const EXTERNAL_VIDEO_SERVICE_CAPABILITIES_V1 = [
    "artifact.download",
    "artifact.sha256",
    "docker.smoke.external",
];
const ENV_KEYS = [
    "CM_VIDEO_REFERENCE_ARTIFACT_URL",
    "CM_VIDEO_REFERENCE_ARTIFACT_SHA256",
    "CM_VIDEO_REFERENCE_VERSION",
    "CM_VIDEO_REFERENCE_CONTRACT_VERSION",
    "CM_VIDEO_REFERENCE_TIMEOUT_MS",
];
const DENIED_HOSTS = new Set(["localhost", "0.0.0.0", "127.0.0.1", "::1", "[::1]", "::", "[::]", "169.254.169.254"]);
const UNSAFE_TEXT = /\b(?:upload|publish|youtube|post|public\s+action|tts|voice|credential|secret|token|docker\s+sock|host\s+mount|privileged|exec)\b/i;
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function disabled() {
    return {
        outcome: "DISABLED",
        reasonCodes: ["EXTERNAL_VIDEO_SERVICE_NOT_CONFIGURED"],
        config: {
            schemaVersion: EXTERNAL_VIDEO_SERVICE_CONFIG_SCHEMA_V1,
            enabled: false,
            artifactUrl: null,
            artifactSha256: null,
            expectedProductVersion: EXTERNAL_VIDEO_SERVICE_MIN_PRODUCT_VERSION_V1,
            minContractVersion: EXTERNAL_VIDEO_SERVICE_MIN_CONTRACT_VERSION_V1,
            timeoutMs: 5000,
            allowedCapabilities: EXTERNAL_VIDEO_SERVICE_CAPABILITIES_V1,
        },
    };
}
function sanitizeArtifactUrl(input) {
    if (input.length > 2048 || /[\u0000-\u001f\s]/.test(input) || /%40/i.test(input))
        return null;
    let parsed;
    try {
        parsed = new URL(input);
    }
    catch {
        return null;
    }
    if (parsed.protocol !== "https:")
        return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
        return null;
    const host = parsed.hostname.toLowerCase();
    if (!host || DENIED_HOSTS.has(host) || isPrivateIpv4(host) || isIP(host) === 6)
        return null;
    if (!parsed.pathname.endsWith(".tar.gz"))
        return null;
    return parsed.toString();
}
function isPrivateIpv4(host) {
    if (isIP(host) !== 4)
        return false;
    const octets = host.split(".").map(Number);
    const [a, b] = octets;
    if (octets.length !== 4 || a === undefined || b === undefined)
        return false;
    return a === 10
        || a === 127
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 169 && b === 254)
        || a === 0;
}
function parseTimeout(value) {
    if (value === undefined || value === "")
        return 5000;
    if (!/^[0-9]{2,6}$/.test(value))
        return null;
    const parsed = Number(value);
    return parsed >= 100 && parsed <= 30000 ? parsed : null;
}
function isSha256(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
export function configureExternalVideoServiceV1(env) {
    const hasAny = ENV_KEYS.some((key) => env[key] !== undefined && env[key] !== "");
    if (!hasAny)
        return disabled();
    const artifactUrl = env.CM_VIDEO_REFERENCE_ARTIFACT_URL
        ? sanitizeArtifactUrl(env.CM_VIDEO_REFERENCE_ARTIFACT_URL)
        : null;
    if (!artifactUrl)
        return { outcome: "DENIED", reasonCodes: ["EXTERNAL_VIDEO_SERVICE_URL_DENIED"] };
    if (!isSha256(env.CM_VIDEO_REFERENCE_ARTIFACT_SHA256)) {
        return { outcome: "DENIED", reasonCodes: ["EXTERNAL_VIDEO_SERVICE_SHA256_DENIED"] };
    }
    const timeoutMs = parseTimeout(env.CM_VIDEO_REFERENCE_TIMEOUT_MS);
    if (timeoutMs === null)
        return { outcome: "DENIED", reasonCodes: ["EXTERNAL_VIDEO_SERVICE_TIMEOUT_DENIED"] };
    const expectedProductVersion = env.CM_VIDEO_REFERENCE_VERSION ?? EXTERNAL_VIDEO_SERVICE_MIN_PRODUCT_VERSION_V1;
    if (expectedProductVersion !== EXTERNAL_VIDEO_SERVICE_MIN_PRODUCT_VERSION_V1) {
        return { outcome: "DENIED", reasonCodes: ["EXTERNAL_VIDEO_SERVICE_VERSION_DENIED"] };
    }
    const minContractVersion = env.CM_VIDEO_REFERENCE_CONTRACT_VERSION ?? EXTERNAL_VIDEO_SERVICE_MIN_CONTRACT_VERSION_V1;
    if (minContractVersion !== EXTERNAL_VIDEO_SERVICE_MIN_CONTRACT_VERSION_V1) {
        return { outcome: "DENIED", reasonCodes: ["EXTERNAL_VIDEO_SERVICE_VERSION_DENIED"] };
    }
    return {
        outcome: "VERIFIED",
        reasonCodes: ["EXTERNAL_VIDEO_SERVICE_CONFIG_VERIFIED"],
        config: {
            schemaVersion: EXTERNAL_VIDEO_SERVICE_CONFIG_SCHEMA_V1,
            enabled: true,
            artifactUrl,
            artifactSha256: env.CM_VIDEO_REFERENCE_ARTIFACT_SHA256,
            expectedProductVersion,
            minContractVersion,
            timeoutMs,
            allowedCapabilities: EXTERNAL_VIDEO_SERVICE_CAPABILITIES_V1,
        },
    };
}
export async function probeExternalVideoServiceV1(decision, fetchImpl = fetch) {
    if (decision.outcome === "DISABLED")
        return { outcome: "DISABLED", reasonCodes: decision.reasonCodes };
    if (decision.outcome === "DENIED")
        return decision;
    const { config } = decision;
    if (config.artifactUrl === null || config.artifactSha256 === null) {
        return { outcome: "DENIED", reasonCodes: ["EXTERNAL_VIDEO_SERVICE_URL_DENIED"] };
    }
    try {
        const response = await fetchImpl(config.artifactUrl, {
            method: "GET",
            signal: AbortSignal.timeout(config.timeoutMs),
        });
        if (!response.ok)
            return { outcome: "UNAVAILABLE", reasonCodes: ["EXTERNAL_VIDEO_SERVICE_ARTIFACT_UNAVAILABLE"] };
        const bytes = Buffer.from(await response.arrayBuffer());
        const actual = createHash("sha256").update(bytes).digest("hex");
        if (actual !== config.artifactSha256) {
            return { outcome: "DENIED", reasonCodes: ["EXTERNAL_VIDEO_SERVICE_ARTIFACT_DIGEST_MISMATCH"] };
        }
        return {
            outcome: "VERIFIED",
            reasonCodes: ["EXTERNAL_VIDEO_SERVICE_CONFIG_VERIFIED"],
            readback: {
                schemaVersion: EXTERNAL_VIDEO_SERVICE_READBACK_SCHEMA_V1,
                outcome: "READY",
                expectedProductVersion: config.expectedProductVersion,
                minContractVersion: config.minContractVersion,
                artifactSha256: actual,
                capabilities: config.allowedCapabilities,
                dockerOwnedByCm: false,
                renderEndpointsExposedByCm: false,
                uploadEndpointsExposedByCm: false,
                credentialsForwardedByCm: false,
            },
        };
    }
    catch {
        return { outcome: "UNAVAILABLE", reasonCodes: ["EXTERNAL_VIDEO_SERVICE_ARTIFACT_UNAVAILABLE"] };
    }
}
export function assertExternalVideoServiceRequestV1(request) {
    if (!isRecord(request) || typeof request.action !== "string")
        return ["EXTERNAL_VIDEO_SERVICE_CONFIG_DENIED"];
    if (["render", "validate-and-render", "qa", "dockerRun", "tts"].includes(request.action)) {
        return ["EXTERNAL_VIDEO_SERVICE_RENDER_DENIED"];
    }
    if (["upload", "publish", "youtube", "publicAction"].includes(request.action)) {
        return ["EXTERNAL_VIDEO_SERVICE_PUBLICATION_DENIED"];
    }
    if (request.action === "validateJob") {
        const digest = request.jobDigest;
        if (!isSha256(typeof digest === "string" ? digest : undefined))
            return ["EXTERNAL_VIDEO_SERVICE_UNSAFE_REQUEST_DENIED"];
        return [];
    }
    if (request.action === "artifactReadback")
        return [];
    if (UNSAFE_TEXT.test(request.action))
        return ["EXTERNAL_VIDEO_SERVICE_UNSAFE_REQUEST_DENIED"];
    return ["EXTERNAL_VIDEO_SERVICE_UNSAFE_REQUEST_DENIED"];
}

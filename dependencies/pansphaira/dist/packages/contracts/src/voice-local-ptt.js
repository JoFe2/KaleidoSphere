import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize, parse } from "node:path";
export const VOICE_CONFIG_SCHEMA_V1 = "chimpmaera.voice/config/v1";
export const VOICE_STT_REQUEST_SCHEMA_V1 = "chimpmaera.voice/stt-request/v1";
export const VOICE_STT_RESULT_SCHEMA_V1 = "chimpmaera.voice/stt-result/v1";
export const VOICE_TTS_REQUEST_SCHEMA_V1 = "chimpmaera.voice/tts-request/v1";
export const VOICE_TTS_RESULT_SCHEMA_V1 = "chimpmaera.voice/tts-result/v1";
export const VOICE_TURN_REQUEST_SCHEMA_V1 = "chimpmaera.voice/turn-request/v1";
export const VOICE_TURN_RESULT_SCHEMA_V1 = "chimpmaera.voice/turn-result/v1";
export const VOICE_RECEIPT_SCHEMA_V1 = "chimpmaera.voice/receipt/v1";
export const VOICE_LOCAL_PTT_PROFILE = "VOICE_LOCAL_PTT";
const CONFIG_KEYS = ["schemaVersion", "enabled", "retention", "whisperBinary", "whisperBinaryDigest", "whisperAdapterRevision", "whisperModel", "whisperModelDigest", "ttsBinary", "ttsBinaryDigest", "ttsAdapterRevision", "ttsModel", "ttsModelDigest", "timeoutMs", "maxAudioBytes", "maxDurationMs", "maxTextBytes", "maxOutputBytes", "maxProcessOutputBytes"];
const IDS = ["sessionId", "turnId", "correlationId"];
const DIGEST = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9:_-]{1,128}$/;
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
    return isRecord(value) && Object.keys(value).length === keys.length
        && Object.keys(value).every((key) => keys.includes(key));
}
function idsValid(value) {
    return IDS.every((key) => typeof value[key] === "string" && IDENTIFIER.test(value[key]));
}
function languageValid(value) { return value === "de" || value === "en"; }
function digestValid(value) { return typeof value === "string" && DIGEST.test(value); }
function positiveSafe(value) { return Number.isSafeInteger(value) && Number(value) > 0; }
function textValid(value, maxBytes) {
    return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= maxBytes
        && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}
function trustedPath(value) {
    return typeof value === "string" && isAbsolute(value) && normalize(value) === value
        && value !== parse(value).root && !value.includes("\0") && !value.split("/").includes("..");
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
export function validateVoiceAdapterConfigV1(value) {
    if (!exactKeys(value, CONFIG_KEYS) || value.schemaVersion !== VOICE_CONFIG_SCHEMA_V1
        || typeof value.enabled !== "boolean" || !["EPHEMERAL", "OPERATOR_POLICY"].includes(String(value.retention)))
        return false;
    const paths = [value.whisperBinary, value.whisperModel, value.ttsBinary, value.ttsModel];
    const digests = [value.whisperBinaryDigest, value.whisperModelDigest, value.ttsBinaryDigest, value.ttsModelDigest];
    const revisions = [value.whisperAdapterRevision, value.ttsAdapterRevision];
    const limits = [value.timeoutMs, value.maxAudioBytes, value.maxDurationMs, value.maxTextBytes, value.maxOutputBytes, value.maxProcessOutputBytes];
    return paths.every(trustedPath) && new Set(paths).size === paths.length && digests.every(digestValid)
        && revisions.every((item) => typeof item === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(item))
        && limits.every(positiveSafe) && Number(value.maxProcessOutputBytes) <= 16 * 1024 * 1024;
}
export function validateVoiceSttRequestV1(value) {
    const keys = ["schemaVersion", ...IDS, "language", "codec", "audioBytes", "durationMs"];
    return exactKeys(value, keys) && value.schemaVersion === VOICE_STT_REQUEST_SCHEMA_V1 && idsValid(value)
        && languageValid(value.language) && (value.codec === "wav" || value.codec === "pcm_s16le")
        && positiveSafe(value.audioBytes) && positiveSafe(value.durationMs);
}
export function validateVoiceSttResultV1(value, maxTextBytes = 16_384) {
    const keys = ["schemaVersion", ...IDS, "language", "transcript", "trust", "retention"];
    return exactKeys(value, keys) && value.schemaVersion === VOICE_STT_RESULT_SCHEMA_V1 && idsValid(value)
        && languageValid(value.language) && textValid(value.transcript, maxTextBytes)
        && value.trust === "UNTRUSTED_VOICE_TRANSCRIPT" && (value.retention === "EPHEMERAL" || value.retention === "OPERATOR_POLICY");
}
export function validateVoiceTtsRequestV1(value, maxTextBytes = 16_384) {
    const keys = ["schemaVersion", ...IDS, "language", "text", "codec"];
    return exactKeys(value, keys) && value.schemaVersion === VOICE_TTS_REQUEST_SCHEMA_V1 && idsValid(value)
        && languageValid(value.language) && textValid(value.text, maxTextBytes) && value.codec === "wav";
}
export function validateVoiceTtsResultV1(value) {
    const keys = ["schemaVersion", ...IDS, "language", "codec", "audioBytes"];
    return exactKeys(value, keys) && value.schemaVersion === VOICE_TTS_RESULT_SCHEMA_V1 && idsValid(value)
        && languageValid(value.language) && value.codec === "wav" && positiveSafe(value.audioBytes);
}
export function validateVoiceReceiptV1(value) {
    const keys = ["schemaVersion", ...IDS, "operation", "language", "trust", "retention", "adapterRevisionDigest", "modelDigest", "configDigest", "outcome"];
    return exactKeys(value, keys) && value.schemaVersion === VOICE_RECEIPT_SCHEMA_V1 && idsValid(value)
        && ["STT", "TTS", "TURN"].includes(String(value.operation)) && languageValid(value.language)
        && ["UNTRUSTED_VOICE_TRANSCRIPT", "UNTRUSTED_SYNTHETIC_AUDIO"].includes(String(value.trust))
        && ["EPHEMERAL", "OPERATOR_POLICY"].includes(String(value.retention))
        && digestValid(value.adapterRevisionDigest) && digestValid(value.modelDigest) && digestValid(value.configDigest)
        && value.outcome === "ACCEPTED";
}
export const localBoundedProcessRunnerV1 = async (request) => {
    if (!trustedPath(request.executable) || !trustedPath(request.cwd) || !positiveSafe(request.timeoutMs)
        || !positiveSafe(request.maxStdoutBytes) || !positiveSafe(request.maxStderrBytes)
        || !Array.isArray(request.argv) || request.argv.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
        throw new Error("VOICE_RUNNER_REQUEST_INVALID");
    }
    return await new Promise((resolvePromise, rejectPromise) => {
        execFile(request.executable, [...request.argv], {
            cwd: request.cwd,
            shell: false,
            timeout: request.timeoutMs,
            killSignal: "SIGKILL",
            encoding: "buffer",
            maxBuffer: Math.max(request.maxStdoutBytes, request.maxStderrBytes) + 1,
            windowsHide: true,
        }, (error, stdout, stderr) => {
            if (error && "code" in error && error.code === "ENOENT")
                return rejectPromise(new Error("VOICE_RUNNER_BINARY_MISSING"));
            if (error && "killed" in error && error.killed)
                return rejectPromise(new Error("VOICE_RUNNER_TIMEOUT"));
            if (error && "code" in error && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
                return rejectPromise(new Error("VOICE_RUNNER_OUTPUT_LIMIT"));
            if (stdout.byteLength > request.maxStdoutBytes || stderr.byteLength > request.maxStderrBytes)
                return rejectPromise(new Error("VOICE_RUNNER_OUTPUT_LIMIT"));
            resolvePromise({ exitCode: error && "code" in error && typeof error.code === "number" ? error.code : 0, stdout, stderr });
        });
    });
};
async function assertArtifact(path, expectedDigest, kind) {
    try {
        const metadata = await stat(path);
        if (!metadata.isFile())
            throw new Error();
        const bytes = await readFile(path);
        if (sha256(bytes) !== expectedDigest)
            throw new Error(`VOICE_${kind}_DIGEST_MISMATCH`);
    }
    catch (error) {
        if (error instanceof Error && error.message.endsWith("DIGEST_MISMATCH"))
            throw error;
        throw new Error(`VOICE_${kind}_MISSING`);
    }
}
function sameIds(left, right) {
    return IDS.every((key) => left[key] === right[key]);
}
function validWave(bytes) {
    if (bytes.byteLength < 44 || Buffer.from(bytes.subarray(0, 4)).toString("ascii") !== "RIFF"
        || Buffer.from(bytes.subarray(8, 12)).toString("ascii") !== "WAVE")
        return false;
    const declared = Buffer.from(bytes).readUInt32LE(4);
    return declared + 8 === bytes.byteLength;
}
export class VoiceLocalPttV1 {
    run;
    config;
    constructor(config, run = localBoundedProcessRunnerV1) {
        this.run = run;
        if (!validateVoiceAdapterConfigV1(config))
            throw new Error("VOICE_CONFIG_INVALID");
        this.config = config;
    }
    assertEnabled() { if (!this.config.enabled)
        throw new Error("VOICE_PROFILE_DISABLED"); }
    configDigest(adapter) {
        const value = adapter === "whisper"
            ? { adapter, revision: this.config.whisperAdapterRevision, binaryDigest: this.config.whisperBinaryDigest, modelDigest: this.config.whisperModelDigest }
            : { adapter, revision: this.config.ttsAdapterRevision, binaryDigest: this.config.ttsBinaryDigest, modelDigest: this.config.ttsModelDigest };
        return sha256(JSON.stringify({ ...value, timeoutMs: this.config.timeoutMs, maxAudioBytes: this.config.maxAudioBytes, maxDurationMs: this.config.maxDurationMs, maxTextBytes: this.config.maxTextBytes, maxOutputBytes: this.config.maxOutputBytes, maxProcessOutputBytes: this.config.maxProcessOutputBytes, retention: this.config.retention }));
    }
    receipt(ids, operation, language) {
        const stt = operation === "STT";
        return {
            schemaVersion: VOICE_RECEIPT_SCHEMA_V1,
            sessionId: ids.sessionId,
            turnId: ids.turnId,
            correlationId: ids.correlationId,
            operation,
            language,
            trust: stt ? "UNTRUSTED_VOICE_TRANSCRIPT" : "UNTRUSTED_SYNTHETIC_AUDIO",
            retention: this.config.retention,
            adapterRevisionDigest: sha256(stt ? this.config.whisperAdapterRevision : this.config.ttsAdapterRevision),
            modelDigest: stt ? this.config.whisperModelDigest : this.config.ttsModelDigest,
            configDigest: this.configDigest(stt ? "whisper" : "tts"),
            outcome: "ACCEPTED",
        };
    }
    async transcribe(value, audio) {
        this.assertEnabled();
        if (!validateVoiceSttRequestV1(value))
            throw new Error("VOICE_STT_REQUEST_INVALID");
        if (value.audioBytes !== audio.byteLength || audio.byteLength > this.config.maxAudioBytes || value.durationMs > this.config.maxDurationMs)
            throw new Error("VOICE_AUDIO_LIMIT_EXCEEDED");
        await assertArtifact(this.config.whisperBinary, this.config.whisperBinaryDigest, "BINARY");
        await assertArtifact(this.config.whisperModel, this.config.whisperModelDigest, "MODEL");
        const directory = await mkdtemp(join(tmpdir(), "cm-voice-"));
        try {
            const input = join(directory, value.codec === "wav" ? "input.wav" : "input.pcm");
            const base = join(directory, "transcript");
            await writeFile(input, audio, { mode: 0o600 });
            const process = await this.run({ executable: this.config.whisperBinary, argv: ["-m", this.config.whisperModel, "-f", input, "-l", value.language, "-otxt", "-of", base], cwd: directory, timeoutMs: this.config.timeoutMs, maxStdoutBytes: this.config.maxProcessOutputBytes, maxStderrBytes: this.config.maxProcessOutputBytes });
            if (process.stdout.byteLength > this.config.maxProcessOutputBytes || process.stderr.byteLength > this.config.maxProcessOutputBytes)
                throw new Error("VOICE_RUNNER_OUTPUT_LIMIT");
            if (process.exitCode !== 0)
                throw new Error("VOICE_STT_PROCESS_FAILED");
            let transcript;
            try {
                transcript = (await readFile(`${base}.txt`, "utf8")).trim();
            }
            catch {
                throw new Error("VOICE_STT_OUTPUT_MALFORMED");
            }
            const result = { schemaVersion: VOICE_STT_RESULT_SCHEMA_V1, sessionId: value.sessionId, turnId: value.turnId, correlationId: value.correlationId, language: value.language, transcript, trust: "UNTRUSTED_VOICE_TRANSCRIPT", retention: this.config.retention };
            if (!validateVoiceSttResultV1(result, this.config.maxTextBytes))
                throw new Error("VOICE_STT_OUTPUT_MALFORMED");
            return { result, receipt: this.receipt(value, "STT", value.language) };
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
    async synthesize(value) {
        this.assertEnabled();
        if (!validateVoiceTtsRequestV1(value, this.config.maxTextBytes))
            throw new Error("VOICE_TTS_REQUEST_INVALID");
        await assertArtifact(this.config.ttsBinary, this.config.ttsBinaryDigest, "BINARY");
        await assertArtifact(this.config.ttsModel, this.config.ttsModelDigest, "MODEL");
        const directory = await mkdtemp(join(tmpdir(), "cm-voice-"));
        try {
            const output = join(directory, "output.wav");
            const process = await this.run({ executable: this.config.ttsBinary, argv: ["--model", this.config.ttsModel, "--text", value.text, "--language", value.language, "--output", output], cwd: directory, timeoutMs: this.config.timeoutMs, maxStdoutBytes: this.config.maxProcessOutputBytes, maxStderrBytes: this.config.maxProcessOutputBytes });
            if (process.stdout.byteLength > this.config.maxProcessOutputBytes || process.stderr.byteLength > this.config.maxProcessOutputBytes)
                throw new Error("VOICE_RUNNER_OUTPUT_LIMIT");
            if (process.exitCode !== 0)
                throw new Error("VOICE_TTS_PROCESS_FAILED");
            let audio;
            try {
                audio = await readFile(output);
            }
            catch {
                throw new Error("VOICE_TTS_OUTPUT_MALFORMED");
            }
            if (audio.byteLength > this.config.maxOutputBytes || !validWave(audio))
                throw new Error("VOICE_TTS_OUTPUT_MALFORMED");
            const result = { schemaVersion: VOICE_TTS_RESULT_SCHEMA_V1, sessionId: value.sessionId, turnId: value.turnId, correlationId: value.correlationId, language: value.language, codec: "wav", audioBytes: audio.byteLength };
            if (!validateVoiceTtsResultV1(result))
                throw new Error("VOICE_TTS_OUTPUT_MALFORMED");
            return { result, audio, receipt: this.receipt(value, "TTS", value.language) };
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    }
}
export function composeVoiceTurnV1(stt, receipt, expected, maxTextBytes = 16_384) {
    if (!validateVoiceSttResultV1(stt, maxTextBytes) || !validateVoiceReceiptV1(receipt) || receipt.operation !== "STT")
        throw new Error("VOICE_COMPOSE_INPUT_INVALID");
    if (!sameIds(stt, receipt) || stt.language !== receipt.language || stt.trust !== receipt.trust || stt.retention !== receipt.retention)
        throw new Error("VOICE_CORRELATION_MISMATCH");
    if (!digestValid(expected.modelDigest) || !digestValid(expected.configDigest)
        || receipt.modelDigest !== expected.modelDigest || receipt.configDigest !== expected.configDigest)
        throw new Error("VOICE_DIGEST_MISMATCH");
    const result = { schemaVersion: VOICE_TURN_RESULT_SCHEMA_V1, sessionId: stt.sessionId, turnId: stt.turnId, correlationId: stt.correlationId, language: stt.language, transcript: stt.transcript, trust: "UNTRUSTED_VOICE_TRANSCRIPT", authority: "NONE", boundary: "CM_GOVERNED_INPUT" };
    return { result, receipt: { ...receipt, schemaVersion: VOICE_RECEIPT_SCHEMA_V1, operation: "TURN" } };
}
export function proposeVoiceTurnV1(value, maxTextBytes = 16_384) {
    const keys = ["schemaVersion", ...IDS, "language", "transcript", "trust", "retention", "modelDigest", "configDigest"];
    if (!exactKeys(value, keys) || value.schemaVersion !== VOICE_TURN_REQUEST_SCHEMA_V1 || !idsValid(value)
        || !languageValid(value.language) || !textValid(value.transcript, maxTextBytes) || value.trust !== "UNTRUSTED_VOICE_TRANSCRIPT"
        || (value.retention !== "EPHEMERAL" && value.retention !== "OPERATOR_POLICY") || !digestValid(value.modelDigest) || !digestValid(value.configDigest))
        throw new Error("VOICE_TURN_REQUEST_INVALID");
    const ids = { sessionId: String(value.sessionId), turnId: String(value.turnId), correlationId: String(value.correlationId) };
    const result = { schemaVersion: VOICE_TURN_RESULT_SCHEMA_V1, ...ids, language: value.language, transcript: value.transcript, trust: "UNTRUSTED_VOICE_TRANSCRIPT", authority: "NONE", boundary: "CM_GOVERNED_INPUT" };
    return { result, receipt: { schemaVersion: VOICE_RECEIPT_SCHEMA_V1, ...ids, operation: "TURN", language: value.language, trust: "UNTRUSTED_VOICE_TRANSCRIPT", retention: value.retention, adapterRevisionDigest: value.configDigest, modelDigest: value.modelDigest, configDigest: value.configDigest, outcome: "ACCEPTED" } };
}

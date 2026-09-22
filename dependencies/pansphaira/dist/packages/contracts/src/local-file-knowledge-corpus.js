import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonical-json.js";
export const LOCAL_FILE_CORPUS_PROFILE_SCHEMA_V1 = "chimpmaera.knowledge/local-file-corpus-profile/v1";
export const LOCAL_FILE_CORPUS_EDITION_SCHEMA_V1 = "chimpmaera.knowledge/local-file-corpus-edition/v1";
export const LOCAL_FILE_CORPUS_QUERY_SCHEMA_V1 = "chimpmaera.knowledge/local-file-corpus-query-receipt/v1";
export const LOCAL_FILE_CORPUS_BOUNDARY_V1 = "READ_ONLY_LOCAL_UTF8_TEXT_NO_NETWORK_DOWNLOAD_WRITE_EXECUTION_OR_TRUTH_AUTHORITY";
/**
 * The persistent read index is a projection, not a second source of truth.
 * Its accepted and LKG bindings are written with the active edition and are
 * recomputed from the immutable manifest before they can be used.
 */
export const LOCAL_FILE_CORPUS_INDEX_SCHEMA_V1 = "chimpmaera.knowledge/local-file-corpus-active-index/v1";
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/;
const RELATIVE_FILE = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:md|txt)$/;
const SOURCE_ID = /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/;
const sha256Bytes = (value) => createHash("sha256").update(value).digest("hex");
const sha256Canonical = (value) => sha256Bytes(canonicalJson(value));
const exactKeys = (value, keys) => canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
const dataRecord = (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype)
        return false;
    return Object.values(Object.getOwnPropertyDescriptors(value)).every((item) => "value" in item && item.enumerable);
};
const safeInteger = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const uniqueStrings = (value, predicate, maximum = 64) => Array.isArray(value) && value.length <= maximum
    && value.every((item) => typeof item === "string" && predicate(item))
    && new Set(value).size === value.length;
const safeRelativeFile = (value) => typeof value === "string"
    && value.length <= 240 && RELATIVE_FILE.test(value)
    && value.split("/").every((part) => part !== "." && part !== "..");
const sortedUnique = (items) => [...new Set(items)].sort();
function validateProfile(value) {
    if (!dataRecord(value) || !exactKeys(value, [
        "schemaVersion", "enabled", "corpusId", "editionId", "priorEditionId",
        "observedAtMs", "files", "conflicts",
    ]) || value.schemaVersion !== LOCAL_FILE_CORPUS_PROFILE_SCHEMA_V1
        || typeof value.enabled !== "boolean" || !ID.test(String(value.corpusId))
        || !ID.test(String(value.editionId))
        || !(value.priorEditionId === null || ID.test(String(value.priorEditionId)))
        || !safeInteger(value.observedAtMs) || !Array.isArray(value.files)
        || value.files.length < 1 || value.files.length > 64 || !Array.isArray(value.conflicts))
        return false;
    const paths = new Set();
    for (const item of value.files) {
        if (!dataRecord(item) || !exactKeys(item, [
            "path", "expectedContentDigest", "licence", "permittedUses", "sharedSourceIds",
        ]) || !safeRelativeFile(item.path) || !DIGEST.test(String(item.expectedContentDigest))
            || !["CC0-1.0", "CC-BY-4.0", "APACHE-2.0", "MIT", "OWNER_AUTHORIZED"].includes(String(item.licence))
            || !uniqueStrings(item.permittedUses, (entry) => ["CURATED_READ", "EXPLORATORY_READ"].includes(entry), 2)
            || item.permittedUses.length < 1
            || !uniqueStrings(item.sharedSourceIds, (entry) => SOURCE_ID.test(entry), 16)
            || paths.has(item.path))
            return false;
        paths.add(item.path);
    }
    return value.conflicts.length <= 64 && value.conflicts.every((item) => dataRecord(item) && exactKeys(item, ["left", "right", "kind"])
        && dataRecord(item.left) && exactKeys(item.left, ["path", "line"])
        && dataRecord(item.right) && exactKeys(item.right, ["path", "line"])
        && paths.has(String(item.left.path)) && paths.has(String(item.right.path))
        && safeInteger(item.left.line, 1) && safeInteger(item.right.line, 1)
        && ["CONTRADICTION", "SOURCE_DEPENDENCY"].includes(String(item.kind)));
}
function walkRegularFiles(root, relative = "") {
    const directory = path.join(root, relative);
    const entries = readdirSync(directory, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
        const candidate = relative ? `${relative}/${entry.name}` : entry.name;
        const absolute = path.join(root, candidate);
        const stat = lstatSync(absolute);
        if (stat.isSymbolicLink())
            throw new Error("LOCAL_FILE_CORPUS_SYMLINK_DENIED");
        if (stat.isDirectory())
            result.push(...walkRegularFiles(root, candidate));
        else if (stat.isFile())
            result.push(candidate);
        else
            throw new Error("LOCAL_FILE_CORPUS_NONREGULAR_DENIED");
    }
    return result.sort();
}
const chunkUnsigned = (pathName, line, text) => ({
    citationId: `citation:${sha256Canonical({ path: pathName, line, text }).slice(0, 24)}`,
    citation: `${pathName}#L${line}`,
    startLine: line,
    endLine: line,
    text,
});
export function localFileCorpusManifestDigestV1(value) {
    return sha256Canonical(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "manifestDigest")));
}
export function localFileCorpusReceiptDigestV1(value) {
    return sha256Canonical(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "receiptDigest")));
}
function localFileCorpusIndexUnsignedV1(accepted, lastKnownGood) {
    return {
        schemaVersion: LOCAL_FILE_CORPUS_INDEX_SCHEMA_V1,
        corpusId: accepted.corpusId,
        activeEditionId: accepted.editionId,
        acceptedEditionId: accepted.editionId,
        lastKnownGoodEditionId: lastKnownGood.editionId,
        manifestDigest: accepted.manifestDigest,
        entries: accepted.files.flatMap((file) => file.chunks.map((chunk) => ({
            editionId: accepted.editionId,
            citationId: chunk.citationId,
            citation: chunk.citation,
            path: file.path,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            text: chunk.text,
            chunkDigest: chunk.chunkDigest,
        }))),
    };
}
export function localFileCorpusIndexDigestV1(value) {
    return sha256Canonical(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "indexDigest")));
}
export function buildLocalFileCorpusIndexV1(accepted, lastKnownGood) {
    if (!validateLocalFileCorpusEditionV1(accepted) || !validateLocalFileCorpusEditionV1(lastKnownGood)
        || accepted.corpusId !== lastKnownGood.corpusId) {
        throw new Error("LOCAL_FILE_CORPUS_INDEX_DENIED");
    }
    const unsigned = localFileCorpusIndexUnsignedV1(accepted, lastKnownGood);
    return { ...unsigned, indexDigest: localFileCorpusIndexDigestV1(unsigned) };
}
export function validateLocalFileCorpusIndexV1(value) {
    if (!dataRecord(value) || !exactKeys(value, [
        "schemaVersion", "corpusId", "activeEditionId", "acceptedEditionId", "lastKnownGoodEditionId",
        "manifestDigest", "entries", "indexDigest",
    ]) || value.schemaVersion !== LOCAL_FILE_CORPUS_INDEX_SCHEMA_V1
        || !ID.test(String(value.corpusId)) || !ID.test(String(value.activeEditionId))
        || value.acceptedEditionId !== value.activeEditionId || !ID.test(String(value.lastKnownGoodEditionId))
        || !DIGEST.test(String(value.manifestDigest)) || !Array.isArray(value.entries)
        || value.entries.length < 1 || !DIGEST.test(String(value.indexDigest)))
        return false;
    const citations = new Set();
    for (const entry of value.entries) {
        if (!dataRecord(entry) || !exactKeys(entry, [
            "editionId", "citationId", "citation", "path", "startLine", "endLine", "text", "chunkDigest",
        ]) || entry.editionId !== value.activeEditionId || !safeRelativeFile(entry.path)
            || typeof entry.citationId !== "string" || !/^citation:[a-f0-9]{24}$/.test(entry.citationId)
            || typeof entry.citation !== "string" || entry.citation !== `${entry.path}#L${String(entry.startLine)}`
            || !safeInteger(entry.startLine, 1) || entry.endLine !== entry.startLine
            || typeof entry.text !== "string" || entry.text.length === 0 || !DIGEST.test(String(entry.chunkDigest))
            || citations.has(entry.citationId))
            return false;
        citations.add(entry.citationId);
    }
    return localFileCorpusIndexDigestV1(value) === value.indexDigest;
}
export function readLocalFileCorpusEditionV1(rootInput, profileInput) {
    if (!validateProfile(profileInput))
        throw new Error("LOCAL_FILE_CORPUS_PROFILE_DENIED");
    const profile = profileInput;
    if (!profile.enabled)
        throw new Error("LOCAL_FILE_CORPUS_DISABLED");
    const root = path.resolve(rootInput);
    const rootStat = lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync(root) !== root) {
        throw new Error("LOCAL_FILE_CORPUS_ROOT_DENIED");
    }
    const declared = [...profile.files].sort((left, right) => left.path.localeCompare(right.path));
    const actualPaths = walkRegularFiles(root);
    if (canonicalJson(actualPaths) !== canonicalJson(declared.map((item) => item.path))) {
        throw new Error("LOCAL_FILE_CORPUS_CLOSED_MANIFEST_DENIED");
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const files = declared.map((declaration) => {
        const absolute = path.join(root, declaration.path);
        const stat = lstatSync(absolute);
        if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(absolute) !== absolute) {
            throw new Error("LOCAL_FILE_CORPUS_FILE_DENIED");
        }
        const bytes = readFileSync(absolute);
        const contentDigest = sha256Bytes(bytes);
        if (contentDigest !== declaration.expectedContentDigest) {
            throw new Error("LOCAL_FILE_CORPUS_CONTENT_DRIFT_DENIED");
        }
        let text;
        try {
            text = decoder.decode(bytes);
        }
        catch {
            throw new Error("LOCAL_FILE_CORPUS_UTF8_DENIED");
        }
        if (text.includes("\r") || text.includes("\0") || text.length > 1_000_000) {
            throw new Error("LOCAL_FILE_CORPUS_TEXT_DENIED");
        }
        const lines = text.split("\n");
        if (lines.at(-1) === "")
            lines.pop();
        const chunks = lines.flatMap((lineText, index) => {
            if (lineText.length === 0)
                return [];
            const unsigned = chunkUnsigned(declaration.path, index + 1, lineText);
            return [{ ...unsigned, chunkDigest: sha256Canonical(unsigned) }];
        });
        return {
            path: declaration.path,
            contentDigest,
            lineCount: lines.length,
            licence: declaration.licence,
            permittedUses: sortedUnique(declaration.permittedUses),
            sharedSourceIds: sortedUnique(declaration.sharedSourceIds),
            chunks,
        };
    });
    const byCitation = new Map(files.flatMap((file) => file.chunks.map((chunk) => [
        `${file.path}:${chunk.startLine}`, chunk.citationId,
    ])));
    const conflicts = profile.conflicts.map((conflict) => {
        const leftCitationId = byCitation.get(`${conflict.left.path}:${conflict.left.line}`);
        const rightCitationId = byCitation.get(`${conflict.right.path}:${conflict.right.line}`);
        if (!leftCitationId || !rightCitationId || leftCitationId === rightCitationId) {
            throw new Error("LOCAL_FILE_CORPUS_CONFLICT_BINDING_DENIED");
        }
        return { leftCitationId, rightCitationId, kind: conflict.kind };
    }).sort((left, right) => `${left.leftCitationId}:${left.rightCitationId}`.localeCompare(`${right.leftCitationId}:${right.rightCitationId}`));
    const rootDigest = sha256Canonical(files.map((file) => ({ path: file.path, contentDigest: file.contentDigest })));
    const unsigned = {
        schemaVersion: LOCAL_FILE_CORPUS_EDITION_SCHEMA_V1,
        corpusId: profile.corpusId,
        editionId: profile.editionId,
        priorEditionId: profile.priorEditionId,
        observedAtMs: profile.observedAtMs,
        rootDigest,
        files,
        conflicts,
        authorityBoundary: LOCAL_FILE_CORPUS_BOUNDARY_V1,
    };
    return { ...unsigned, manifestDigest: localFileCorpusManifestDigestV1(unsigned) };
}
export function validateLocalFileCorpusEditionV1(value) {
    if (value.schemaVersion !== LOCAL_FILE_CORPUS_EDITION_SCHEMA_V1
        || value.authorityBoundary !== LOCAL_FILE_CORPUS_BOUNDARY_V1
        || !ID.test(value.corpusId) || !ID.test(value.editionId)
        || !(value.priorEditionId === null || ID.test(value.priorEditionId))
        || !safeInteger(value.observedAtMs) || !DIGEST.test(value.rootDigest)
        || !DIGEST.test(value.manifestDigest) || value.files.length < 1)
        return false;
    const paths = value.files.map((file) => file.path);
    if (canonicalJson(paths) !== canonicalJson([...paths].sort()) || new Set(paths).size !== paths.length)
        return false;
    const citations = new Set();
    for (const file of value.files) {
        if (!safeRelativeFile(file.path) || !DIGEST.test(file.contentDigest)
            || !safeInteger(file.lineCount) || file.chunks.length < 1)
            return false;
        for (const chunk of file.chunks) {
            const unsigned = chunkUnsigned(file.path, chunk.startLine, chunk.text);
            if (chunk.endLine !== chunk.startLine || chunk.citationId !== unsigned.citationId
                || chunk.citation !== unsigned.citation || chunk.chunkDigest !== sha256Canonical(unsigned)
                || citations.has(chunk.citationId))
                return false;
            citations.add(chunk.citationId);
        }
    }
    if (value.conflicts.some((item) => !citations.has(item.leftCitationId)
        || !citations.has(item.rightCitationId) || item.leftCitationId === item.rightCitationId))
        return false;
    const expectedRoot = sha256Canonical(value.files.map((file) => ({
        path: file.path, contentDigest: file.contentDigest,
    })));
    return value.rootDigest === expectedRoot
        && value.manifestDigest === localFileCorpusManifestDigestV1(value);
}
const queryTokens = (query) => sortedUnique(query.toLowerCase().split(/[^a-z0-9]+/).filter((item) => item.length >= 2));
export function queryLocalFileCorpusV1(edition, query, permittedUse, maxResults = 20) {
    if (!validateLocalFileCorpusEditionV1(edition) || typeof query !== "string"
        || query.length < 2 || query.length > 160 || !safeInteger(maxResults, 1) || maxResults > 100) {
        throw new Error("LOCAL_FILE_CORPUS_QUERY_DENIED");
    }
    const tokens = queryTokens(query);
    if (tokens.length < 1 || tokens.length > 16)
        throw new Error("LOCAL_FILE_CORPUS_QUERY_DENIED");
    const conflictMap = new Map();
    for (const conflict of edition.conflicts) {
        conflictMap.set(conflict.leftCitationId, [...(conflictMap.get(conflict.leftCitationId) ?? []), conflict.rightCitationId]);
        conflictMap.set(conflict.rightCitationId, [...(conflictMap.get(conflict.rightCitationId) ?? []), conflict.leftCitationId]);
    }
    const results = edition.files.flatMap((file) => file.chunks.flatMap((chunk) => {
        if (!file.permittedUses.includes(permittedUse))
            return [];
        const words = queryTokens(chunk.text);
        const score = tokens.reduce((total, token) => total + words.filter((word) => word === token).length, 0);
        if (score === 0)
            return [];
        return [{
                citationId: chunk.citationId,
                citation: chunk.citation,
                path: file.path,
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                text: chunk.text,
                chunkDigest: chunk.chunkDigest,
                score,
                licence: file.licence,
                permittedUses: file.permittedUses,
                sharedSourceIds: file.sharedSourceIds,
                conflictsWith: sortedUnique(conflictMap.get(chunk.citationId) ?? []),
            }];
    })).sort((left, right) => right.score - left.score
        || left.path.localeCompare(right.path) || left.startLine - right.startLine).slice(0, maxResults);
    const unsigned = {
        schemaVersion: LOCAL_FILE_CORPUS_QUERY_SCHEMA_V1,
        corpusId: edition.corpusId,
        editionId: edition.editionId,
        manifestDigest: edition.manifestDigest,
        normalizedQuery: tokens.join(" "),
        queryTokens: tokens,
        results,
        authorityBoundary: LOCAL_FILE_CORPUS_BOUNDARY_V1,
    };
    return { ...unsigned, receiptDigest: localFileCorpusReceiptDigestV1(unsigned) };
}
export function activateLocalFileCorpusEditionV1(current, candidate, injectFailureAt = "NONE") {
    const valid = validateLocalFileCorpusEditionV1(current.accepted)
        && validateLocalFileCorpusEditionV1(current.lastKnownGood)
        && validateLocalFileCorpusEditionV1(candidate)
        && current.accepted.manifestDigest === current.lastKnownGood.manifestDigest
        && candidate.corpusId === current.accepted.corpusId
        && candidate.priorEditionId === current.accepted.editionId
        && candidate.editionId !== current.accepted.editionId;
    if (!valid)
        return {
            outcome: "ROLLED_BACK", registry: current, stagedResidue: [], reason: "CANDIDATE_DENIED",
        };
    if (injectFailureAt !== "NONE")
        return {
            outcome: "ROLLED_BACK", registry: current, stagedResidue: [], reason: "INJECTED_FAILURE",
        };
    return {
        outcome: "ACTIVATED",
        registry: { accepted: candidate, lastKnownGood: current.accepted },
        stagedResidue: [],
        reason: "ACTIVATED",
    };
}

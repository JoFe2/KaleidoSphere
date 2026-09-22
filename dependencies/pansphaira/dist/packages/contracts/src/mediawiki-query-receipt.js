import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import { validateMediaWikiMiniDumpEditionV1, } from "./mediawiki-mini-dump.js";
export const MEDIAWIKI_READONLY_QUERY_RECEIPT_SCHEMA_V1 = "chimpmaera.knowledge/mediawiki-readonly-query-receipt/v1";
export const MEDIAWIKI_READONLY_QUERY_BOUNDARY_V1 = "READ_ONLY_LOCAL_MEDIAWIKI_SYNTHETIC_NO_NETWORK_NO_MODEL_NO_EXECUTION_AUTHORITY";
const DIGEST = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const RESULT_ID = /^mediawiki-result:[a-f0-9]{64}$/;
const sha256 = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const exactKeys = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
const safeInteger = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const nonEmptyText = (value, maximum = 4096) => typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value);
const digest = (value) => typeof value === "string" && DIGEST.test(value);
const status = (value) => typeof value === "string" && ["VERIFIED", "SUPPORTED", "UNVERIFIED", "DISPUTED", "UNRESOLVED"].includes(value);
export function mediaWikiReadonlyQueryReceiptDigestV1(value) {
    return sha256(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "receiptDigest")));
}
export function mediaWikiReadonlyQueryResultIdV1(editionDigest, citationId) {
    return `mediawiki-result:${sha256({ editionDigest, citationId })}`;
}
export function validateMediaWikiReadonlyEditionSourceV1(value) {
    if (!exactKeys(value, ["edition", "state", "epistemicStatus", "freshnessState"]))
        return false;
    return validateMediaWikiMiniDumpEditionV1(value.edition)
        && ["ACTIVE", "SELECTED", "STALE", "REVOKED"].includes(value.state)
        && status(value.epistemicStatus)
        && ["CURRENT", "HISTORICAL", "STALE"].includes(value.freshnessState)
        && value.state !== "STALE" && value.state !== "REVOKED"
        && value.freshnessState !== "STALE";
}
export function validateMediaWikiReadonlyQueryCorpusV1(value) {
    if (!exactKeys(value, ["active", "selected"]) || !validateMediaWikiReadonlyEditionSourceV1(value.active)
        || value.active.state !== "ACTIVE" || value.active.freshnessState !== "CURRENT"
        || !Array.isArray(value.selected) || value.selected.length > 32
        || !value.selected.every((item) => validateMediaWikiReadonlyEditionSourceV1(item)
            && item.state === "SELECTED"))
        return false;
    const digests = [value.active.edition.editionDigest, ...value.selected.map((item) => item.edition.editionDigest)];
    return new Set(digests).size === digests.length;
}
function validLicense(value) {
    return exactKeys(value, ["attributionTemplate", "licence"])
        && typeof value.licence === "string"
        && ["CC0-1.0", "CC-BY-4.0", "APACHE-2.0", "MIT", "OWNER_AUTHORIZED"].includes(value.licence)
        && nonEmptyText(value.attributionTemplate, 512);
}
function validResult(value) {
    if (!exactKeys(value, [
        "resultId", "editionId", "editionState", "citationId", "citation", "exactPassage", "project", "language",
        "pageId", "revisionId", "title", "canonicalUrl", "snapshotDate", "license", "contentDigest", "editionDigest",
        "chunkDigest", "score", "ranking", "sourceEpistemicStatus", "epistemicStatus", "freshness", "conflictsWith",
    ]))
        return false;
    if (!RESULT_ID.test(String(value.resultId)) || !nonEmptyText(value.editionId, 128)
        || !["ACTIVE", "SELECTED"].includes(value.editionState)
        || !/^citation:[a-f0-9]{24}$/.test(String(value.citationId)) || !/^.+#L[1-9][0-9]*$/.test(String(value.citation))
        || !nonEmptyText(value.exactPassage, 2048) || !nonEmptyText(value.project, 128) || !nonEmptyText(value.language, 32)
        || !safeInteger(value.pageId, 1) || !safeInteger(value.revisionId, 1) || !nonEmptyText(value.title, 255)
        || !/^https:\/\//.test(String(value.canonicalUrl)) || typeof value.snapshotDate !== "string" || !DATE.test(value.snapshotDate)
        || !validLicense(value.license) || !digest(value.contentDigest) || !digest(value.editionDigest) || !digest(value.chunkDigest)
        || typeof value.score !== "number" || !Number.isSafeInteger(value.score) || value.score <= 0
        || !status(value.sourceEpistemicStatus) || !status(value.epistemicStatus))
        return false;
    if (!exactKeys(value.ranking, ["strategy", "lexicalScore", "titleScore", "exactPhrase", "matchedTokens"])
        || !["EXACT_LEXICAL", "LOCAL_HYBRID"].includes(value.ranking.strategy)
        || !safeInteger(value.ranking.lexicalScore) || !safeInteger(value.ranking.titleScore)
        || typeof value.ranking.exactPhrase !== "boolean" || !Array.isArray(value.ranking.matchedTokens)
        || !value.ranking.matchedTokens.every((item) => typeof item === "string" && /^[a-z0-9]{2,}$/.test(item))
        || new Set(value.ranking.matchedTokens).size !== value.ranking.matchedTokens.length)
        return false;
    if (!exactKeys(value.freshness, ["state", "snapshotDate", "revisionTimestamp"])
        || !["CURRENT", "HISTORICAL", "STALE"].includes(value.freshness.state)
        || value.freshness.snapshotDate !== value.snapshotDate || typeof value.freshness.revisionTimestamp !== "string"
        || !TIMESTAMP.test(value.freshness.revisionTimestamp) || !Array.isArray(value.conflictsWith)
        || !value.conflictsWith.every((item) => RESULT_ID.test(item) && item !== value.resultId)
        || new Set(value.conflictsWith).size !== value.conflictsWith.length)
        return false;
    if (value.resultId !== mediaWikiReadonlyQueryResultIdV1(value.editionDigest, value.citationId))
        return false;
    if (value.conflictsWith.length > 0 && value.epistemicStatus !== "DISPUTED")
        return false;
    return true;
}
export function validateMediaWikiReadonlyQueryReceiptV1(value) {
    if (!exactKeys(value, [
        "schemaVersion", "operation", "network", "model", "query", "normalizedQuery", "queryTokens", "ranking",
        "maxResults", "activeEditionDigest", "selectedEditionDigests", "contradictions", "results", "authority",
        "authorityBoundary", "receiptDigest",
    ]))
        return false;
    if (value.schemaVersion !== MEDIAWIKI_READONLY_QUERY_RECEIPT_SCHEMA_V1 || value.operation !== "READ_ONLY_QUERY"
        || value.network !== "DISABLED" || value.model !== "DISABLED" || !nonEmptyText(value.query, 160)
        || !nonEmptyText(value.normalizedQuery, 160) || !Array.isArray(value.queryTokens) || value.queryTokens.length < 1
        || !value.queryTokens.every((item) => typeof item === "string" && /^[a-z0-9]{2,}$/.test(item))
        || new Set(value.queryTokens).size !== value.queryTokens.length
        || [...value.queryTokens].sort().join(" ") !== value.queryTokens.join(" ")
        || value.normalizedQuery !== value.queryTokens.join(" ")
        || !["EXACT_LEXICAL", "LOCAL_HYBRID"].includes(value.ranking)
        || !safeInteger(value.maxResults, 1) || value.maxResults > 100 || !digest(value.activeEditionDigest)
        || !Array.isArray(value.selectedEditionDigests) || !value.selectedEditionDigests.every(digest)
        || !Array.isArray(value.results) || !value.results.every(validResult)
        || value.authorityBoundary !== MEDIAWIKI_READONLY_QUERY_BOUNDARY_V1 || !digest(value.receiptDigest))
        return false;
    if (!exactKeys(value.authority, ["credentials", "policyApprovals", "capabilities", "toolAccess", "writeTargets", "executionRoutes"])
        || !Object.values(value.authority).every((item) => Array.isArray(item) && item.length === 0))
        return false;
    if (!Array.isArray(value.contradictions) || !value.contradictions.every((item) => exactKeys(item, ["claimIds", "kind"]) && item.kind === "CONTRADICTION" && Array.isArray(item.claimIds)
        && item.claimIds.length >= 2 && item.claimIds.every((claimId) => RESULT_ID.test(claimId))
        && new Set(item.claimIds).size === item.claimIds.length))
        return false;
    const allEditionDigests = [value.activeEditionDigest, ...value.selectedEditionDigests];
    if (new Set(allEditionDigests).size !== allEditionDigests.length)
        return false;
    if (value.results.length > value.maxResults * allEditionDigests.length)
        return false;
    if (new Set(value.results.map((item) => item.resultId)).size !== value.results.length)
        return false;
    const resultIds = new Set(value.results.map((item) => item.resultId));
    if (value.results.some((item) => !allEditionDigests.includes(item.editionDigest)
        || (item.editionDigest === value.activeEditionDigest ? item.editionState !== "ACTIVE" : item.editionState !== "SELECTED")))
        return false;
    const contradictionPairs = new Set();
    for (const contradiction of value.contradictions) {
        for (const claimId of contradiction.claimIds) {
            if (!resultIds.has(claimId))
                return false;
            for (const other of contradiction.claimIds) {
                if (claimId !== other)
                    contradictionPairs.add([claimId, other].sort().join("\u0000"));
            }
        }
    }
    for (const result of value.results) {
        for (const conflict of result.conflictsWith) {
            if (!resultIds.has(conflict) || !contradictionPairs.has([result.resultId, conflict].sort().join("\u0000")))
                return false;
        }
    }
    for (const pair of contradictionPairs) {
        const [left, right] = pair.split("\u0000");
        if (!left || !right || !value.results.find((item) => item.resultId === left)?.conflictsWith.includes(right)
            || !value.results.find((item) => item.resultId === right)?.conflictsWith.includes(left))
            return false;
    }
    const rankedResultIds = new Set(value.results.slice(0, value.maxResults).map((item) => item.resultId));
    if (value.results.slice(value.maxResults).some((item) => item.epistemicStatus !== "DISPUTED"
        || !item.conflictsWith.some((claimId) => rankedResultIds.has(claimId))))
        return false;
    return mediaWikiReadonlyQueryReceiptDigestV1(value) === value.receiptDigest;
}
export function validateMediaWikiReadonlyQueryReceiptAgainstCorpusV1(receipt, corpus) {
    if (!validateMediaWikiReadonlyQueryReceiptV1(receipt) || !validateMediaWikiReadonlyQueryCorpusV1(corpus)
        || receipt.activeEditionDigest !== corpus.active.edition.editionDigest
        || canonicalJson(receipt.selectedEditionDigests) !== canonicalJson(corpus.selected.map((item) => item.edition.editionDigest)))
        return false;
    const sources = [corpus.active, ...corpus.selected];
    const sourceByDigest = new Map(sources.map((source) => [source.edition.editionDigest, source]));
    for (const result of receipt.results) {
        const source = sourceByDigest.get(result.editionDigest);
        if (!source || result.editionId !== source.edition.editionId || result.editionState !== source.state)
            return false;
        const page = source.edition.pages.find((candidate) => candidate.pageId === result.pageId);
        const chunk = page?.chunks.find((candidate) => candidate.citationId === result.citationId);
        if (!page || !chunk || result.resultId !== mediaWikiReadonlyQueryResultIdV1(source.edition.editionDigest, chunk.citationId)
            || result.citation !== chunk.citation || result.exactPassage !== chunk.text || result.project !== source.edition.project
            || result.language !== source.edition.language || result.revisionId !== page.revisionId || result.title !== page.title
            || result.canonicalUrl !== page.canonicalUrl || result.snapshotDate !== source.edition.dump.snapshotDate
            || canonicalJson(result.license) !== canonicalJson(source.edition.license) || result.contentDigest !== page.contentDigest
            || result.chunkDigest !== chunk.chunkDigest || result.sourceEpistemicStatus !== source.epistemicStatus
            || (result.conflictsWith.length === 0 && result.epistemicStatus !== source.epistemicStatus)
            || result.freshness.state !== source.freshnessState || result.freshness.snapshotDate !== source.edition.dump.snapshotDate
            || result.freshness.revisionTimestamp !== page.timestamp)
            return false;
    }
    return true;
}
export const validateMediaWikiReadonlyQueryReceipt = validateMediaWikiReadonlyQueryReceiptV1;

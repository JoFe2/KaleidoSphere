import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonical-json.js";
import { KNOWLEDGE_AUTHORITY_BOUNDARY_V1, knowledgeEnvelopeDigestV1, selectKnowledgeV1, validateKnowledgeEnvelopeV1, validateKnowledgeTaxonomyV1, } from "./knowledge-envelope.js";
import { activateLocalFileCorpusEditionV1, localFileCorpusManifestDigestV1, queryLocalFileCorpusV1, validateLocalFileCorpusEditionV1, } from "./local-file-knowledge-corpus.js";
import { MEDIAWIKI_MINI_DUMP_CANONICALIZER_VERSION_V1, MEDIAWIKI_MINI_DUMP_PARSER_VERSION_V1, projectMediaWikiMiniDumpEditionV1, } from "./mediawiki-mini-dump.js";
/**
 * PSAI107's additive local XML source adapter.
 *
 * This module owns no Accepted, LKG, rollback, truth or MediaWiki-specific
 * registry state. It reads one explicitly supplied synthetic XML snapshot,
 * projects it in memory into the existing contracts, validates those values,
 * and delegates the only lifecycle transition to the existing local-file
 * corpus contract.
 */
export const MEDIAWIKI_XML_LOCAL_PROFILE_SCHEMA_V1 = "chimpmaera.knowledge/mediawiki-xml-local-profile/v1";
export const MEDIAWIKI_XML_LOCAL_BOUNDARY_V1 = "READ_ONLY_EXPLICIT_LOCAL_MEDIAWIKI_XML_SYNTHETIC_SOURCE_NO_NETWORK_DOWNLOAD_WRITE_EXECUTION_OR_TRUTH_AUTHORITY";
export const MEDIAWIKI_XML_LOCAL_PILOT_KIND_V1 = "BOUNDED_OFFICIAL_PILOT_SYNTHETIC_TEST_DOUBLE";
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/;
const SOURCE_PATH = /^[A-Za-z0-9._-]+\.xml$/;
const JSON_PATH = /^[A-Za-z0-9._-]+\.json$/;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z]{1,8})*$/;
const SNAPSHOT_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_URL = /^https:\/\/[a-z0-9][a-z0-9.-]*(?::\d{1,5})?\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;
const LICENCES = [
    "CC0-1.0",
    "CC-BY-4.0",
    "APACHE-2.0",
    "MIT",
    "OWNER_AUTHORIZED",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const digestOf = (value) => sha256(canonicalJson(value));
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value, keys) => isRecord(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
const nonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const validDate = (value) => {
    if (!SNAPSHOT_DATE.test(value))
        return false;
    const [yearText, monthText, dayText] = value.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
function fail(code) {
    throw new Error(`MEDIAWIKI_XML_LOCAL_${code}`);
}
export function validateMediaWikiXmlLocalProfileV1(value) {
    if (!isRecord(value))
        return false;
    const profile = value;
    if (!exactKeys(profile, [
        "authorityBoundary", "canonicalizerVersion", "corpus", "enabled", "knowledge", "license",
        "manifestPath", "negativeMatrixPath", "networkAllowed", "parserVersion", "pilot", "schemaVersion",
        "site", "source", "syntheticOnly",
    ]) || profile.schemaVersion !== MEDIAWIKI_XML_LOCAL_PROFILE_SCHEMA_V1
        || profile.enabled !== true || profile.syntheticOnly !== true || profile.networkAllowed !== false
        || profile.authorityBoundary !== MEDIAWIKI_XML_LOCAL_BOUNDARY_V1
        || profile.parserVersion !== MEDIAWIKI_MINI_DUMP_PARSER_VERSION_V1
        || profile.canonicalizerVersion !== MEDIAWIKI_MINI_DUMP_CANONICALIZER_VERSION_V1)
        return false;
    if (!exactKeys(profile.pilot, ["kind", "language", "project", "snapshotDate", "sourceUrl"])
        || profile.pilot.kind !== MEDIAWIKI_XML_LOCAL_PILOT_KIND_V1
        || typeof profile.pilot.sourceUrl !== "string" || !SOURCE_URL.test(profile.pilot.sourceUrl)
        || typeof profile.pilot.snapshotDate !== "string" || !validDate(profile.pilot.snapshotDate)
        || typeof profile.pilot.project !== "string" || !ID.test(profile.pilot.project)
        || typeof profile.pilot.language !== "string" || !LANGUAGE.test(profile.pilot.language))
        return false;
    if (typeof profile.manifestPath !== "string" || !JSON_PATH.test(profile.manifestPath)
        || typeof profile.negativeMatrixPath !== "string" || !JSON_PATH.test(profile.negativeMatrixPath)
        || profile.manifestPath === profile.negativeMatrixPath)
        return false;
    if (!exactKeys(profile.source, ["byteSize", "expectedSourceDigest", "path"])
        || typeof profile.source.path !== "string" || !SOURCE_PATH.test(profile.source.path)
        || typeof profile.source.expectedSourceDigest !== "string" || !DIGEST.test(profile.source.expectedSourceDigest)
        || !positiveInteger(profile.source.byteSize) || profile.source.byteSize > 8_388_608)
        return false;
    if (!exactKeys(profile.site, ["base", "name"]) || typeof profile.site.name !== "string"
        || profile.site.name.length < 1 || profile.site.name.length > 128
        || typeof profile.site.base !== "string"
        || !/^https:\/\/[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\/wiki$/.test(profile.site.base))
        return false;
    if (!exactKeys(profile.license, ["attributionTemplate", "licence"])
        || typeof profile.license.licence !== "string" || !LICENCES.includes(profile.license.licence)
        || typeof profile.license.attributionTemplate !== "string"
        || profile.license.attributionTemplate.length < 1 || profile.license.attributionTemplate.length > 512)
        return false;
    if (!exactKeys(profile.corpus, ["corpusId", "editionId", "observedAtMs", "priorEditionId"])
        || typeof profile.corpus.corpusId !== "string" || !ID.test(profile.corpus.corpusId)
        || typeof profile.corpus.editionId !== "string" || !ID.test(profile.corpus.editionId)
        || !(profile.corpus.priorEditionId === null || (typeof profile.corpus.priorEditionId === "string" && ID.test(profile.corpus.priorEditionId)))
        || !nonNegativeInteger(profile.corpus.observedAtMs))
        return false;
    if (!exactKeys(profile.knowledge, ["scopeNamespace", "staleAfterMs", "taxonomyDigest", "taxonomyGeneration", "taxonomyId"])
        || typeof profile.knowledge.scopeNamespace !== "string" || profile.knowledge.scopeNamespace.length < 1 || profile.knowledge.scopeNamespace.length > 96
        || !nonNegativeInteger(profile.knowledge.staleAfterMs)
        || typeof profile.knowledge.taxonomyId !== "string" || !ID.test(profile.knowledge.taxonomyId)
        || !positiveInteger(profile.knowledge.taxonomyGeneration)
        || typeof profile.knowledge.taxonomyDigest !== "string" || !DIGEST.test(profile.knowledge.taxonomyDigest))
        return false;
    return true;
}
function assertProfile(value) {
    if (!validateMediaWikiXmlLocalProfileV1(value))
        fail("PROFILE_DENIED");
    return value;
}
function assertRegularFile(location, code) {
    let stat;
    try {
        stat = lstatSync(location);
    }
    catch {
        fail(code);
    }
    if (!stat.isFile() || stat.isSymbolicLink())
        fail(code);
    try {
        if (realpathSync(location) !== location)
            fail(code);
    }
    catch {
        fail(code);
    }
}
function assertRoot(rootInput, profile) {
    if (typeof rootInput !== "string" || rootInput.length === 0)
        fail("ROOT_DENIED");
    const root = path.resolve(rootInput);
    let stat;
    try {
        stat = lstatSync(root);
    }
    catch {
        fail("ROOT_DENIED");
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root)
        fail("ROOT_DENIED");
    const expected = [profile.manifestPath, profile.negativeMatrixPath, profile.source.path].sort();
    let entries;
    try {
        entries = readdirSync(root);
    }
    catch {
        fail("ROOT_DENIED");
    }
    if (canonicalJson(entries) !== canonicalJson(expected))
        fail("CLOSED_MANIFEST_DENIED");
    for (const entry of entries)
        assertRegularFile(path.join(root, entry), "CLOSED_MANIFEST_DENIED");
    return root;
}
function miniDumpProfile(profile) {
    return {
        schemaVersion: "chimpmaera.knowledge/mediawiki-mini-dump-profile/v1",
        enabled: true,
        project: profile.pilot.project,
        language: profile.pilot.language,
        site: profile.site,
        source: profile.source,
        xmlFiles: [profile.source.path],
        dump: {
            kind: "CURRENT_PAGES_MINI_DUMP",
            sourceUrl: profile.pilot.sourceUrl,
            snapshotDate: profile.pilot.snapshotDate,
        },
        license: profile.license,
        parserVersion: MEDIAWIKI_MINI_DUMP_PARSER_VERSION_V1,
        canonicalizerVersion: MEDIAWIKI_MINI_DUMP_CANONICALIZER_VERSION_V1,
    };
}
function localChunk(pathName, line, text) {
    const unsigned = {
        citationId: `citation:${digestOf({ path: pathName, line, text }).slice(0, 24)}`,
        citation: `${pathName}#L${line}`,
        startLine: line,
        endLine: line,
        text,
    };
    return { ...unsigned, chunkDigest: digestOf(unsigned) };
}
function projectLocalEdition(profile, sourceDigest, miniDumpEdition) {
    const files = miniDumpEdition.pages.map((page) => {
        const filePath = `page-${page.pageId}.txt`;
        const chunks = page.chunks.map((chunk) => localChunk(filePath, chunk.line, chunk.text));
        return {
            path: filePath,
            contentDigest: sha256(new TextEncoder().encode(page.text)),
            lineCount: page.text.split("\n").length,
            licence: profile.license.licence,
            permittedUses: ["EXPLORATORY_READ"],
            sharedSourceIds: [`mediawiki-xml:${sourceDigest.slice(0, 40)}`],
            chunks,
        };
    }).sort((left, right) => left.path.localeCompare(right.path));
    const unsigned = {
        schemaVersion: "chimpmaera.knowledge/local-file-corpus-edition/v1",
        corpusId: profile.corpus.corpusId,
        editionId: profile.corpus.editionId,
        priorEditionId: profile.corpus.priorEditionId,
        observedAtMs: profile.corpus.observedAtMs,
        rootDigest: digestOf(files.map((file) => ({ path: file.path, contentDigest: file.contentDigest }))),
        files,
        conflicts: [],
        authorityBoundary: "READ_ONLY_LOCAL_UTF8_TEXT_NO_NETWORK_DOWNLOAD_WRITE_EXECUTION_OR_TRUTH_AUTHORITY",
    };
    const edition = { ...unsigned, manifestDigest: localFileCorpusManifestDigestV1(unsigned) };
    if (!validateLocalFileCorpusEditionV1(edition))
        fail("PROJECTION_DENIED");
    return edition;
}
function projectEnvelopes(profile, sourceDigest, miniDumpEdition, taxonomy) {
    return miniDumpEdition.pages.map((page) => {
        const firstChunk = page.chunks[0];
        if (!firstChunk)
            fail("PROJECTION_DENIED");
        const filePath = `page-${page.pageId}.txt`;
        const unsigned = {
            schemaVersion: "chimpmaera.knowledge/envelope/v1",
            envelopeId: `mediawiki-xml:${digestOf({ sourceDigest, pageId: page.pageId, revisionId: page.revisionId }).slice(0, 40)}`,
            taxonomy: {
                taxonomyId: taxonomy.taxonomyId,
                generation: taxonomy.generation,
                taxonomyDigest: taxonomy.taxonomyDigest,
            },
            scope: { namespace: profile.knowledge.scopeNamespace, audience: "PUBLIC_SYNTHETIC" },
            kind: "UNRESOLVED",
            statement: page.text.replace(/\n/g, " "),
            attribution: [{
                    sourceId: `mediawiki-xml:${sourceDigest.slice(0, 40)}`,
                    citation: `${filePath}#L${firstChunk.line}`,
                    sourceDigest,
                    observedAtMs: profile.corpus.observedAtMs,
                    licence: profile.license.licence,
                }],
            epistemicStatus: "UNVERIFIED",
            trust: "LOW",
            freshness: {
                assessedAtMs: profile.corpus.observedAtMs,
                staleAfterMs: profile.knowledge.staleAfterMs,
            },
            sensitivity: "PUBLIC",
            permittedUses: ["EXPLORATORY_READ"],
            conflictsWith: [],
            derivedFrom: [],
            generationCandidate: "NOT_CANDIDATE",
            authority: {
                credentials: [], policyApprovals: [], capabilities: [],
                toolAccess: [], writeTargets: [], executionRoutes: [],
            },
            authorityBoundary: KNOWLEDGE_AUTHORITY_BOUNDARY_V1,
        };
        const envelope = { ...unsigned, envelopeDigest: knowledgeEnvelopeDigestV1(unsigned) };
        if (validateKnowledgeEnvelopeV1(envelope, taxonomy).length !== 0)
            fail("KNOWLEDGE_CONTRACT_DENIED");
        return envelope;
    });
}
function readAndBindManifest(root, profile) {
    const location = path.join(root, profile.manifestPath);
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(location, "utf8"));
    }
    catch {
        fail("MANIFEST_DENIED");
    }
    if (!canonicalJson(parsed) || canonicalJson(parsed) !== canonicalJson(profile))
        fail("MANIFEST_DENIED");
}
function readAndBindNegativeMatrix(root, profile) {
    const location = path.join(root, profile.negativeMatrixPath);
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(location, "utf8"));
    }
    catch {
        fail("NEGATIVE_MATRIX_DENIED");
    }
    const expected = [
        { caseId: "checksum-mismatch", expected: "MEDIAWIKI_XML_LOCAL_DIGEST_DRIFT_DENIED" },
        { caseId: "hidden-network-fallback", expected: "MEDIAWIKI_XML_LOCAL_SOURCE_DENIED" },
        { caseId: "licence-ambiguity", expected: "MEDIAWIKI_XML_LOCAL_PROFILE_DENIED" },
        { caseId: "missing-source", expected: "MEDIAWIKI_XML_LOCAL_SOURCE_DENIED" },
        { caseId: "synthetic-only", expected: "MEDIAWIKI_XML_LOCAL_PROFILE_DENIED" },
        { caseId: "unbound-lifecycle", expected: "CANDIDATE_DENIED" },
        { caseId: "unsupported-performance-claim", expected: "MEASUREMENT_UNSUPPORTED" },
    ];
    if (canonicalJson(parsed) !== canonicalJson(expected))
        fail("NEGATIVE_MATRIX_DENIED");
}
export function projectMediaWikiXmlLocalV1(profileInput, sourceBytes, taxonomy) {
    const profile = assertProfile(profileInput);
    if (!validateKnowledgeTaxonomyV1(taxonomy)
        || taxonomy.taxonomyId !== profile.knowledge.taxonomyId
        || taxonomy.generation !== profile.knowledge.taxonomyGeneration
        || taxonomy.taxonomyDigest !== profile.knowledge.taxonomyDigest)
        fail("TAXONOMY_DENIED");
    if (sourceBytes.byteLength !== profile.source.byteSize)
        fail("SIZE_DENIED");
    const sourceDigest = sha256(sourceBytes);
    if (sourceDigest !== profile.source.expectedSourceDigest)
        fail("DIGEST_DRIFT_DENIED");
    const miniDumpEdition = projectMediaWikiMiniDumpEditionV1(miniDumpProfile(profile), sourceBytes);
    const edition = projectLocalEdition(profile, sourceDigest, miniDumpEdition);
    const envelopes = projectEnvelopes(profile, sourceDigest, miniDumpEdition, taxonomy);
    return Object.freeze({
        profile,
        source: { path: profile.source.path, sourceDigest, byteSize: sourceBytes.byteLength },
        miniDumpEdition,
        edition,
        envelopes: Object.freeze(envelopes),
    });
}
export function importMediaWikiXmlLocalV1(rootInput, profileInput, taxonomy) {
    const profile = assertProfile(profileInput);
    const root = assertRoot(rootInput, profile);
    readAndBindManifest(root, profile);
    readAndBindNegativeMatrix(root, profile);
    const sourcePath = path.join(root, profile.source.path);
    let bytes;
    try {
        bytes = readFileSync(sourcePath);
    }
    catch {
        fail("SOURCE_DENIED");
    }
    return projectMediaWikiXmlLocalV1(profile, new Uint8Array(bytes), taxonomy);
}
export function queryMediaWikiXmlLocalV1(projection, query, permittedUse = "EXPLORATORY_READ", maxResults = 20) {
    if (!validateLocalFileCorpusEditionV1(projection.edition))
        fail("PROJECTION_DENIED");
    return queryLocalFileCorpusV1(projection.edition, query, permittedUse, maxResults);
}
export function selectMediaWikiXmlLocalKnowledgeV1(projection, taxonomy, evaluatedAtMs, maxResults = 20) {
    if (!nonNegativeInteger(evaluatedAtMs) || !validateKnowledgeTaxonomyV1(taxonomy)
        || projection.envelopes.some((envelope) => validateKnowledgeEnvelopeV1(envelope, taxonomy).length !== 0)) {
        fail("KNOWLEDGE_CONTRACT_DENIED");
    }
    const policy = {
        mode: "EXPLORATORY",
        scopeNamespace: projection.profile.knowledge.scopeNamespace,
        allowedSensitivity: ["PUBLIC"],
        allowedLicences: [projection.profile.license.licence],
        minimumTrust: "LOW",
        evaluatedAtMs,
        allowUnresolvedExploratory: true,
        maxResults,
    };
    return selectKnowledgeV1(taxonomy, projection.envelopes, policy);
}
export function activateMediaWikiXmlLocalEditionV1(current, projection, injectFailureAt = "NONE") {
    if (!validateLocalFileCorpusEditionV1(projection.edition))
        fail("PROJECTION_DENIED");
    return activateLocalFileCorpusEditionV1(current, projection.edition, injectFailureAt);
}
export const importMediaWikiXmlLocalAdapterV1 = importMediaWikiXmlLocalV1;
export const projectMediaWikiXmlLocalAdapterV1 = projectMediaWikiXmlLocalV1;

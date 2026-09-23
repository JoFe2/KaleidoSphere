import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonical-json.js";
export const MEDIAWIKI_MINI_DUMP_PROFILE_SCHEMA_V1 = "chimpmaera.knowledge/mediawiki-mini-dump-profile/v1";
export const MEDIAWIKI_MINI_DUMP_EDITION_SCHEMA_V1 = "chimpmaera.knowledge/mediawiki-mini-dump-edition/v1";
export const MEDIAWIKI_MINI_DUMP_PARSER_VERSION_V1 = "mediawiki-mini-dump-parser/v1";
export const MEDIAWIKI_MINI_DUMP_CANONICALIZER_VERSION_V1 = "mediawiki-mini-dump-canonicalizer/v1";
export const MEDIAWIKI_MINI_DUMP_BOUNDARY_V1 = "OFFLINE_SYNTHETIC_MEDIAWIKI_XML_NO_NETWORK_DOWNLOAD_WRITE_EXECUTION_OR_TRUTH_AUTHORITY";
export const MEDIAWIKI_MINI_DUMP_PILOT_SENTINEL = "PSAI107-CONTAINER-PILOT-ACCEPTANCE";
export const MEDIAWIKI_EXPORT_NAMESPACE_V1 = "http://www.mediawiki.org/xml/export-0.11/";
export const MEDIAWIKI_EXPORT_VERSION_V1 = "0.11";
// ADR-PSAI107-WIKIMEDIA-M0-01 m0Bounds (MWXML-M0-R012) plus closed-parser bounds.
export const MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1 = {
    maximumSourceBytes: 8_388_608,
    maximumPages: 64,
    allowedNamespaceIds: [0],
    allowedContentModels: ["wikitext"],
    revisionsPerPage: 1,
    maximumDecodedRevisionBytesPerPage: 262_144,
    maximumProjectedNonEmptyLines: 4_096,
    maximumEnvelopeStatementCodeUnits: 2_048,
    maximumNestingDepth: 32,
    maximumElementCount: 4_096,
    maximumTitleCodeUnits: 255,
    maximumAttributionTemplateCodeUnits: 512,
    allowDtd: false,
    allowExternalEntities: false,
    allowNetwork: false,
    allowWrites: false,
    allowExecution: false,
};
const MEDIAWIKI_MINI_DUMP_LICENCES_V1 = [
    "CC0-1.0",
    "CC-BY-4.0",
    "APACHE-2.0",
    "MIT",
    "OWNER_AUTHORIZED",
];
const ERROR_PROFILE = "MEDIAWIKI_MINI_DUMP_PROFILE_DENIED";
const ERROR_DISABLED = "MEDIAWIKI_MINI_DUMP_DISABLED";
const ERROR_ROOT = "MEDIAWIKI_MINI_DUMP_ROOT_DENIED";
const ERROR_CLOSED_MANIFEST = "MEDIAWIKI_MINI_DUMP_CLOSED_MANIFEST_DENIED";
const ERROR_SOURCE = "MEDIAWIKI_MINI_DUMP_SOURCE_DENIED";
const ERROR_SIZE = "MEDIAWIKI_MINI_DUMP_SIZE_DENIED";
const ERROR_DIGEST_DRIFT = "MEDIAWIKI_MINI_DUMP_DIGEST_DRIFT_DENIED";
const ERROR_UTF8 = "MEDIAWIKI_MINI_DUMP_UTF8_DENIED";
const ERROR_MALFORMED = "MEDIAWIKI_MINI_DUMP_MALFORMED_DENIED";
const ERROR_PARSE_DEPTH = "MEDIAWIKI_MINI_DUMP_PARSE_DEPTH_DENIED";
const ERROR_UNSAFE_XML = "MEDIAWIKI_MINI_DUMP_UNSAFE_XML_DENIED";
const ERROR_STRUCTURE = "MEDIAWIKI_MINI_DUMP_STRUCTURE_DENIED";
const ERROR_NAMESPACE = "MEDIAWIKI_MINI_DUMP_NAMESPACE_DENIED";
const ERROR_MEDIA = "MEDIAWIKI_MINI_DUMP_MEDIA_DENIED";
const ERROR_PAGE_IDENTITY = "MEDIAWIKI_MINI_DUMP_PAGE_IDENTITY_DENIED";
const ERROR_REVISION_SHAPE = "MEDIAWIKI_MINI_DUMP_REVISION_SHAPE_DENIED";
const ERROR_REVISION_SIZE = "MEDIAWIKI_MINI_DUMP_REVISION_SIZE_DENIED";
const ERROR_TEXT = "MEDIAWIKI_MINI_DUMP_TEXT_DENIED";
const ERROR_MIXED_EDITION = "MEDIAWIKI_MINI_DUMP_MIXED_EDITION_DENIED";
const ERROR_LICENSE = "MEDIAWIKI_MINI_DUMP_LICENSE_DENIED";
const ERROR_PROJECTION = "MEDIAWIKI_MINI_DUMP_PROJECTION_DENIED";
const ERROR_SENTINEL = "MEDIAWIKI_MINI_DUMP_SENTINEL_DENIED";
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/;
const SOURCE_PATH = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.xml$/;
const SITE_BASE = /^https:\/\/[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\/wiki$/;
const SOURCE_URL = /^https:\/\/[a-z0-9][a-z0-9.-]*(?::\d{1,5})?\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z]{1,8})*$/;
const SNAPSHOT_DATE = /^\d{4}-\d{2}-\d{2}$/;
const POSIX_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const sha256Bytes = (value) => createHash("sha256").update(value).digest("hex");
const sha256Canonical = (value) => sha256Bytes(canonicalJson(value));
const exactKeys = (value, keys) => canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
const dataRecord = (value) => {
    if (value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) {
        return false;
    }
    return Object.values(Object.getOwnPropertyDescriptors(value)).every((item) => "value" in item && item.enumerable);
};
const safeInteger = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const isLicence = (value) => typeof value === "string" && MEDIAWIKI_MINI_DUMP_LICENCES_V1.includes(value);
function isValidCalendarDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match)
        return false;
    const rawYear = match[1];
    const rawMonth = match[2];
    const rawDay = match[3];
    if (!rawYear || !rawMonth || !rawDay)
        return false;
    const year = Number(rawYear);
    const month = Number(rawMonth);
    const day = Number(rawDay);
    if (month < 1 || month > 12 || day < 1 || day > 31)
        return false;
    const asUtc = Date.UTC(year, month - 1, day);
    const probe = new Date(asUtc);
    return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}
function isValidTimestamp(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(value);
    if (!match)
        return false;
    const rawYear = match[1];
    const rawMonth = match[2];
    const rawDay = match[3];
    const rawHour = match[4];
    const rawMinute = match[5];
    const rawSecond = match[6];
    if (!rawYear || !rawMonth || !rawDay || !rawHour || !rawMinute || !rawSecond)
        return false;
    if (!isValidCalendarDate(`${rawYear}-${rawMonth}-${rawDay}`))
        return false;
    const hour = Number(rawHour);
    const minute = Number(rawMinute);
    const second = Number(rawSecond);
    return hour <= 23 && minute <= 59 && second <= 59;
}
export function validateMediaWikiMiniDumpProfileV1(value) {
    if (!dataRecord(value) ||
        !exactKeys(value, [
            "canonicalizerVersion",
            "dump",
            "enabled",
            "language",
            "license",
            "parserVersion",
            "project",
            "schemaVersion",
            "site",
            "source",
            "xmlFiles",
        ])) {
        return false;
    }
    if (value.schemaVersion !== MEDIAWIKI_MINI_DUMP_PROFILE_SCHEMA_V1)
        return false;
    if (typeof value.enabled !== "boolean")
        return false;
    if (typeof value.project !== "string" || !ID.test(value.project))
        return false;
    if (typeof value.language !== "string" || !LANGUAGE.test(value.language))
        return false;
    const site = value.site;
    if (!dataRecord(site) ||
        !exactKeys(site, ["base", "name"]) ||
        typeof site.name !== "string" ||
        site.name.length < 1 ||
        site.name.length > 128 ||
        site.name.includes("\0") ||
        typeof site.base !== "string" ||
        !SITE_BASE.test(site.base)) {
        return false;
    }
    const source = value.source;
    if (!dataRecord(source) ||
        !exactKeys(source, ["byteSize", "expectedSourceDigest", "path"]) ||
        typeof source.path !== "string" ||
        source.path.length < 1 ||
        source.path.length > 240 ||
        !SOURCE_PATH.test(source.path) ||
        source.path.includes("/") ||
        source.path.split("/").some((segment) => segment === "." || segment === "..") ||
        typeof source.expectedSourceDigest !== "string" ||
        !DIGEST.test(source.expectedSourceDigest) ||
        !safeInteger(source.byteSize, 1) ||
        source.byteSize > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumSourceBytes) {
        return false;
    }
    if (!Array.isArray(value.xmlFiles) ||
        value.xmlFiles.length < 1 ||
        value.xmlFiles.length > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumPages ||
        !value.xmlFiles.every((item) => typeof item === "string" &&
            item.length >= 1 &&
            item.length <= 240 &&
            SOURCE_PATH.test(item) &&
            !item.includes("/")) ||
        new Set(value.xmlFiles).size !== value.xmlFiles.length ||
        !value.xmlFiles.includes(source.path)) {
        return false;
    }
    const dump = value.dump;
    if (!dataRecord(dump) ||
        !exactKeys(dump, ["kind", "snapshotDate", "sourceUrl"]) ||
        dump.kind !== "CURRENT_PAGES_MINI_DUMP" ||
        typeof dump.sourceUrl !== "string" ||
        dump.sourceUrl.length < 1 ||
        dump.sourceUrl.length > 2048 ||
        !SOURCE_URL.test(dump.sourceUrl) ||
        typeof dump.snapshotDate !== "string" ||
        !SNAPSHOT_DATE.test(dump.snapshotDate) ||
        !isValidCalendarDate(dump.snapshotDate)) {
        return false;
    }
    const license = value.license;
    if (!dataRecord(license) ||
        !exactKeys(license, ["attributionTemplate", "licence"]) ||
        typeof license.licence !== "string" ||
        typeof license.attributionTemplate !== "string" ||
        license.attributionTemplate.length > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumAttributionTemplateCodeUnits) {
        return false;
    }
    if (value.parserVersion !== MEDIAWIKI_MINI_DUMP_PARSER_VERSION_V1)
        return false;
    if (value.canonicalizerVersion !== MEDIAWIKI_MINI_DUMP_CANONICALIZER_VERSION_V1)
        return false;
    return true;
}
function assertMediaWikiMiniDumpProfileV1(value) {
    if (!validateMediaWikiMiniDumpProfileV1(value))
        throw new Error(ERROR_PROFILE);
    return value;
}
function assertMediaWikiMiniDumpLicenceV1(profile) {
    // MWXML-M0-R015: the licence must be inside the exact existing enum and the attribution non-empty.
    if (!isLicence(profile.license.licence))
        throw new Error(ERROR_LICENSE);
    if (profile.license.attributionTemplate.length < 1)
        throw new Error(ERROR_LICENSE);
}
const DEFINED_ENTITIES = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
};
const NAME_START = /^[A-Za-z_]$/;
const NAME_BODY = /^[A-Za-z0-9._:-]$/;
function parseMiniDumpXml(input) {
    const length = input.length;
    let position = 0;
    let elementCount = 0;
    const fail = (code) => {
        throw new Error(code);
    };
    const skipWhitespace = () => {
        while (position < length) {
            const character = input.charAt(position);
            if (character !== " " && character !== "\t" && character !== "\n")
                break;
            position += 1;
        }
    };
    const decodeEntities = (raw) => {
        let decoded = "";
        for (let index = 0; index < raw.length; index += 1) {
            const character = raw.charAt(index);
            if (character !== "&") {
                decoded += character;
                continue;
            }
            const terminator = raw.indexOf(";", index);
            if (terminator === -1)
                fail(ERROR_UNSAFE_XML);
            const entity = raw.slice(index, terminator + 1);
            const replacement = DEFINED_ENTITIES[entity];
            if (replacement === undefined)
                fail(ERROR_UNSAFE_XML);
            decoded += replacement;
            index = terminator;
        }
        return decoded;
    };
    const parseElement = (depth) => {
        if (depth > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumNestingDepth)
            fail(ERROR_PARSE_DEPTH);
        if (elementCount >= MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumElementCount)
            fail(ERROR_PARSE_DEPTH);
        elementCount += 1;
        if (input.charAt(position) !== "<")
            fail(ERROR_MALFORMED);
        position += 1;
        const nameStart = position;
        if (!NAME_START.test(input.charAt(position)))
            fail(ERROR_MALFORMED);
        position += 1;
        while (position < length && NAME_BODY.test(input.charAt(position)))
            position += 1;
        const name = input.slice(nameStart, position);
        const attributes = {};
        let selfClosing = false;
        for (;;) {
            const separatorStart = position;
            skipWhitespace();
            const hasAttributeSeparator = position > separatorStart;
            if (position >= length)
                fail(ERROR_MALFORMED);
            if (input.startsWith("/>", position)) {
                selfClosing = true;
                position += 2;
                break;
            }
            if (input.charAt(position) === ">") {
                position += 1;
                break;
            }
            if (input.startsWith("<", position))
                fail(ERROR_MALFORMED);
            // XML attributes must be separated from the element name and from each
            // other by whitespace. Without this check, a byte sequence such as
            // `xmlns="..."version="0.11"` was accepted as well-formed XML.
            if (!hasAttributeSeparator || !NAME_START.test(input.charAt(position)))
                fail(ERROR_MALFORMED);
            const attributeStart = position;
            while (position < length && NAME_BODY.test(input.charAt(position)))
                position += 1;
            const attributeName = input.slice(attributeStart, position);
            if (attributeName.length === 0)
                fail(ERROR_MALFORMED);
            if (Object.prototype.hasOwnProperty.call(attributes, attributeName))
                fail(ERROR_STRUCTURE);
            skipWhitespace();
            if (input.charAt(position) !== "=")
                fail(ERROR_MALFORMED);
            position += 1;
            skipWhitespace();
            if (input.charAt(position) !== '"')
                fail(ERROR_MALFORMED);
            position += 1;
            const valueStart = position;
            while (position < length && input.charAt(position) !== '"')
                position += 1;
            if (position >= length)
                fail(ERROR_MALFORMED);
            const rawValue = input.slice(valueStart, position);
            if (rawValue.includes("<"))
                fail(ERROR_STRUCTURE);
            attributes[attributeName] = decodeEntities(rawValue);
            position += 1;
        }
        if (selfClosing) {
            return { name, attributes, children: [], text: "" };
        }
        const children = [];
        let text = "";
        for (;;) {
            if (position >= length)
                fail(ERROR_MALFORMED);
            if (input.startsWith("</", position)) {
                position += 2;
                const closeStart = position;
                while (position < length && NAME_BODY.test(input.charAt(position)))
                    position += 1;
                const closeName = input.slice(closeStart, position);
                if (closeName !== name)
                    fail(ERROR_MALFORMED);
                skipWhitespace();
                if (input.charAt(position) !== ">")
                    fail(ERROR_MALFORMED);
                position += 1;
                break;
            }
            if (input.startsWith("<?", position) || input.startsWith("<!", position))
                fail(ERROR_UNSAFE_XML);
            if (input.charAt(position) === "<") {
                children.push(parseElement(depth + 1));
                continue;
            }
            const textStart = position;
            while (position < length && input.charAt(position) !== "<")
                position += 1;
            const rawText = input.slice(textStart, position);
            if (rawText.indexOf("]]>") >= 0)
                fail(ERROR_MALFORMED);
            if (rawText !== "")
                text += decodeEntities(rawText);
        }
        return { name, attributes, children, text };
    };
    skipWhitespace();
    if (input.startsWith("<?xml", position)) {
        const terminator = input.indexOf("?>", position);
        if (terminator === -1)
            fail(ERROR_MALFORMED);
        const declaration = input.slice(position, terminator + 2);
        if (declaration !== `<?xml version="1.0" encoding="UTF-8"?>`)
            fail(ERROR_UNSAFE_XML);
        position = terminator + 2;
        skipWhitespace();
    }
    if (input.startsWith("<?", position) || input.startsWith("<!", position))
        fail(ERROR_UNSAFE_XML);
    const root = parseElement(0);
    skipWhitespace();
    if (position !== length)
        fail(ERROR_MALFORMED);
    return root;
}
function isClosedContainer(node) {
    return node.text.trim() === "" && Object.keys(node.attributes).length === 0;
}
function textOnlyValue(node) {
    if (node.children.length !== 0)
        throw new Error(ERROR_STRUCTURE);
    return node.text;
}
function parseSiteInfo(node) {
    if (node.name !== "siteinfo" || !isClosedContainer(node))
        throw new Error(ERROR_STRUCTURE);
    if (node.children.length !== 2)
        throw new Error(ERROR_STRUCTURE);
    const siteName = node.children[0];
    const base = node.children[1];
    if (!siteName || !base || siteName.name !== "sitename" || base.name !== "base") {
        throw new Error(ERROR_STRUCTURE);
    }
    if (Object.keys(siteName.attributes).length !== 0 || Object.keys(base.attributes).length !== 0) {
        throw new Error(ERROR_STRUCTURE);
    }
    const name = textOnlyValue(siteName);
    const baseValue = textOnlyValue(base);
    if (name.length < 1 || name.length > 128 || name.includes("\0") || !SITE_BASE.test(baseValue)) {
        throw new Error(ERROR_STRUCTURE);
    }
    return { name, base: baseValue };
}
function parseRevision(node) {
    if (node.name !== "revision" || node.text.trim() !== "")
        throw new Error(ERROR_REVISION_SHAPE);
    if (Object.keys(node.attributes).length !== 0)
        throw new Error(ERROR_REVISION_SHAPE);
    if (node.children.length !== 5)
        throw new Error(ERROR_REVISION_SHAPE);
    const revisionId = node.children[0];
    const timestamp = node.children[1];
    const model = node.children[2];
    const format = node.children[3];
    const text = node.children[4];
    if (!revisionId || !timestamp || !model || !format || !text)
        throw new Error(ERROR_REVISION_SHAPE);
    if (revisionId.name !== "id" ||
        timestamp.name !== "timestamp" ||
        model.name !== "model" ||
        format.name !== "format" ||
        text.name !== "text") {
        throw new Error(ERROR_REVISION_SHAPE);
    }
    for (const element of [revisionId, timestamp, model, format]) {
        if (Object.keys(element.attributes).length !== 0 || element.children.length !== 0) {
            throw new Error(ERROR_REVISION_SHAPE);
        }
    }
    const revisionIdText = textOnlyValue(revisionId);
    if (!POSITIVE_INTEGER.test(revisionIdText) || !Number.isSafeInteger(Number(revisionIdText))) {
        throw new Error(ERROR_REVISION_SHAPE);
    }
    const revisionIdNumber = Number(revisionIdText);
    const timestampText = textOnlyValue(timestamp);
    if (!isValidTimestamp(timestampText))
        throw new Error(ERROR_REVISION_SHAPE);
    // MWXML-M0-R002/R013: exactly one revision per page, wikitext only.
    if (textOnlyValue(model) !== "wikitext")
        throw new Error(ERROR_REVISION_SHAPE);
    if (textOnlyValue(format) !== "text/x-wiki")
        throw new Error(ERROR_REVISION_SHAPE);
    if (!exactKeys(text.attributes, ["bytes"]))
        throw new Error(ERROR_REVISION_SHAPE);
    const rawText = textOnlyValue(text);
    if (rawText === "" || rawText.includes("\0") || rawText.includes("\r"))
        throw new Error(ERROR_TEXT);
    for (let index = 0; index < rawText.length; index += 1) {
        const code = rawText.charCodeAt(index);
        if (code < 32 && code !== 10)
            throw new Error(ERROR_TEXT);
    }
    const decodedBytes = Buffer.byteLength(rawText, "utf8");
    if (decodedBytes > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumDecodedRevisionBytesPerPage) {
        throw new Error(ERROR_REVISION_SIZE);
    }
    const declaredBytes = text.attributes.bytes;
    if (declaredBytes === undefined || !POSITIVE_INTEGER.test(declaredBytes) || Number(declaredBytes) !== decodedBytes) {
        throw new Error(ERROR_REVISION_SIZE);
    }
    return { revisionId: revisionIdNumber, timestamp: timestampText, text: rawText };
}
function parsePage(node) {
    if (node.name !== "page" || node.text.trim() !== "")
        throw new Error(ERROR_STRUCTURE);
    if (Object.keys(node.attributes).length !== 0)
        throw new Error(ERROR_STRUCTURE);
    const names = node.children.map((child) => child.name);
    const revisionCount = names.filter((name) => name === "revision").length;
    // MWXML-M0-R002: exactly one revision per page.
    if (revisionCount !== 1)
        throw new Error(ERROR_REVISION_SHAPE);
    if (!names.includes("title") || !names.includes("id"))
        throw new Error(ERROR_PAGE_IDENTITY);
    if (names.length !== 4)
        throw new Error(ERROR_STRUCTURE);
    const title = node.children[0];
    const namespace = node.children[1];
    const pageId = node.children[2];
    const revision = node.children[3];
    if (!title || !namespace || !pageId || !revision)
        throw new Error(ERROR_STRUCTURE);
    if (title.name !== "title" || namespace.name !== "ns" || pageId.name !== "id" || revision.name !== "revision") {
        throw new Error(ERROR_STRUCTURE);
    }
    for (const element of [title, namespace, pageId]) {
        if (Object.keys(element.attributes).length !== 0)
            throw new Error(ERROR_STRUCTURE);
    }
    const pageTitle = textOnlyValue(title);
    if (pageTitle.length < 1 ||
        pageTitle.length > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumTitleCodeUnits ||
        hasForbiddenTextCodePoint(pageTitle, false) ||
        pageTitle.includes("<")) {
        throw new Error(ERROR_TEXT);
    }
    const namespaceValue = textOnlyValue(namespace);
    // MWXML-M0-R003: File/Media namespace pages are media and denied in M0.
    if (namespaceValue === "6")
        throw new Error(ERROR_MEDIA);
    // MWXML-M0-R013: only namespace zero (articles) is admitted.
    if (namespaceValue !== "0")
        throw new Error(ERROR_NAMESPACE);
    const pageIdText = textOnlyValue(pageId);
    if (!POSITIVE_INTEGER.test(pageIdText) || !Number.isSafeInteger(Number(pageIdText))) {
        throw new Error(ERROR_PAGE_IDENTITY);
    }
    const revisionShape = parseRevision(revision);
    return {
        title: pageTitle,
        pageId: Number(pageIdText),
        revisionId: revisionShape.revisionId,
        timestamp: revisionShape.timestamp,
        text: revisionShape.text,
    };
}
function projectParsedDocument(profile, root) {
    if (root.name !== "mediawiki")
        throw new Error(ERROR_STRUCTURE);
    if (!exactKeys(root.attributes, ["xmlns", "version", "xml:lang"]))
        throw new Error(ERROR_STRUCTURE);
    const xmlns = root.attributes.xmlns;
    const version = root.attributes.version;
    const xmlLang = root.attributes["xml:lang"];
    if (xmlns !== MEDIAWIKI_EXPORT_NAMESPACE_V1)
        throw new Error(ERROR_STRUCTURE);
    if (version !== MEDIAWIKI_EXPORT_VERSION_V1)
        throw new Error(ERROR_STRUCTURE);
    if (!xmlLang || !LANGUAGE.test(xmlLang))
        throw new Error(ERROR_STRUCTURE);
    // ADR R010: the document must be the exact pinned snapshot; mixed-edition input is denied.
    if (xmlLang !== profile.language)
        throw new Error(ERROR_MIXED_EDITION);
    if (root.text.trim() !== "")
        throw new Error(ERROR_STRUCTURE);
    let site;
    let pagesStart = 1;
    const firstChild = root.children[0];
    if (firstChild === undefined || firstChild.name !== "siteinfo") {
        throw new Error(ERROR_STRUCTURE);
    }
    site = parseSiteInfo(firstChild);
    if (site.name !== profile.site.name || site.base !== profile.site.base) {
        throw new Error(ERROR_MIXED_EDITION);
    }
    const pageNodes = root.children.slice(pagesStart);
    if (pageNodes.length < 1)
        throw new Error(ERROR_STRUCTURE);
    if (pageNodes.length > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumPages)
        throw new Error(ERROR_PROJECTION);
    const pages = pageNodes.map((node) => parsePage(node));
    const seenPageIds = new Set();
    const seenTitles = new Set();
    const seenRevisionIds = new Set();
    for (const page of pages) {
        // MWXML-M0-R013: unique positive page/revision identity, deterministic titles.
        if (seenPageIds.has(page.pageId))
            throw new Error(ERROR_PAGE_IDENTITY);
        seenPageIds.add(page.pageId);
        if (seenTitles.has(page.title))
            throw new Error(ERROR_PAGE_IDENTITY);
        seenTitles.add(page.title);
        if (seenRevisionIds.has(page.revisionId))
            throw new Error(ERROR_PAGE_IDENTITY);
        seenRevisionIds.add(page.revisionId);
    }
    return { site, pages };
}
// ---------------------------------------------------------------------------
// Canonical edition projection.
//
// The canonical edition digest is computed over the normalized, deterministically
// sorted page content only; raw transport bytes (source checksum and byte size)
// are recorded for provenance but excluded, so semantically reordered inputs with
// the same normalized page content canonicalize to the same edition digest.
// ---------------------------------------------------------------------------
const canonicalTitleOf = (title) => title.replace(/ /g, "_");
const canonicalUrlOf = (siteBase, canonicalTitle) => `${siteBase}/${encodeURIComponent(canonicalTitle)}`;
function hasForbiddenTextCodePoint(value, allowNewline) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code < 32 && !(allowNewline && code === 10))
            return true;
    }
    return value.includes("\0") || value.includes("\r");
}
function chunkUnsigned(canonicalTitle, line, text) {
    return {
        citationId: `citation:${sha256Canonical({ page: canonicalTitle, line, text }).slice(0, 24)}`,
        citation: `${canonicalTitle}#L${line}`,
        line,
        startLine: line,
        endLine: line,
        text,
    };
}
function nonEmptyLines(text) {
    const lines = text.split("\n");
    const trailing = lines[lines.length - 1];
    if (trailing === "")
        lines.pop();
    return lines
        .map((lineText, index) => ({ line: index + 1, text: lineText }))
        .filter((item) => item.text.length > 0);
}
function pageContentDigestOf(unsigned) {
    return sha256Canonical(unsigned);
}
function contentDigestOf(pages) {
    return sha256Canonical(pages.map((page) => ({
        canonicalTitle: page.canonicalTitle,
        canonicalUrl: page.canonicalUrl,
        chunks: page.chunks.map((chunk) => ({
            citation: chunk.citation,
            citationId: chunk.citationId,
            endLine: chunk.endLine,
            line: chunk.line,
            startLine: chunk.startLine,
            text: chunk.text,
        })),
        licence: page.licence,
        namespace: page.namespace,
        pageId: page.pageId,
        revisionId: page.revisionId,
        snapshotDate: page.snapshotDate,
        timestamp: page.timestamp,
        title: page.title,
    })));
}
function buildPageEdition(profile, siteBase, page) {
    const canonicalTitle = canonicalTitleOf(page.title);
    const unsigned = {
        namespace: 0,
        title: page.title,
        canonicalTitle,
        canonicalUrl: canonicalUrlOf(siteBase, canonicalTitle),
        pageId: page.pageId,
        revisionId: page.revisionId,
        timestamp: page.timestamp,
        project: profile.project,
        snapshotDate: profile.dump.snapshotDate,
        licence: profile.license.licence,
        text: page.text,
    };
    const chunks = nonEmptyLines(page.text).map((item) => {
        const unsigned = chunkUnsigned(canonicalTitle, item.line, item.text);
        return { ...unsigned, chunkDigest: sha256Canonical(unsigned) };
    });
    if (chunks.length === 0)
        throw new Error(ERROR_TEXT);
    return { ...unsigned, contentDigest: pageContentDigestOf(unsigned), chunks };
}
function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const item of Object.values(value))
            deepFreeze(item);
    }
    return value;
}
export function queryMediaWikiMiniDumpEditionV1(edition) {
    if (!validateMediaWikiMiniDumpEditionV1(edition))
        throw new Error(ERROR_PROJECTION);
    const results = edition.pages.flatMap((page) => page.chunks.map((chunk) => ({
        citationId: chunk.citationId,
        citation: chunk.citation,
        exactPassage: chunk.text,
        project: edition.project,
        language: edition.language,
        pageId: page.pageId,
        revisionId: page.revisionId,
        title: page.title,
        canonicalUrl: page.canonicalUrl,
        snapshotDate: edition.dump.snapshotDate,
        license: { ...edition.license },
        contentDigest: page.contentDigest,
        editionDigest: edition.editionDigest,
    })));
    return deepFreeze(results);
}
export function projectMediaWikiMiniDumpEditionV1(profileInput, sourceBytes) {
    const profile = assertMediaWikiMiniDumpProfileV1(profileInput);
    if (profile.enabled !== true)
        throw new Error(ERROR_DISABLED);
    assertMediaWikiMiniDumpLicenceV1(profile);
    if (sourceBytes.byteLength < 1)
        throw new Error(ERROR_SIZE);
    if (sourceBytes.byteLength > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumSourceBytes) {
        throw new Error(ERROR_SIZE);
    }
    // MWXML-M0-R010: the source must be the exact pinned bytes.
    if (sha256Bytes(sourceBytes) !== profile.source.expectedSourceDigest)
        throw new Error(ERROR_DIGEST_DRIFT);
    if (sourceBytes.byteLength !== profile.source.byteSize)
        throw new Error(ERROR_SIZE);
    let document;
    try {
        document = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
    }
    catch {
        throw new Error(ERROR_UTF8);
    }
    if (document.includes(MEDIAWIKI_MINI_DUMP_PILOT_SENTINEL))
        throw new Error(ERROR_SENTINEL);
    const root = parseMiniDumpXml(document);
    const { site, pages } = projectParsedDocument(profile, root);
    const siteBase = site.base;
    const builtPages = pages.map((page) => buildPageEdition(profile, siteBase, page));
    const totalLines = builtPages.reduce((sum, page) => sum + page.chunks.length, 0);
    if (totalLines > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumProjectedNonEmptyLines) {
        throw new Error(ERROR_PROJECTION);
    }
    const sortedPages = [...builtPages].sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    const contentDigest = contentDigestOf(sortedPages);
    const unsigned = {
        schemaVersion: MEDIAWIKI_MINI_DUMP_EDITION_SCHEMA_V1,
        project: profile.project,
        language: profile.language,
        dump: {
            kind: profile.dump.kind,
            sourceUrl: profile.dump.sourceUrl,
            snapshotDate: profile.dump.snapshotDate,
        },
        site: { name: site.name, base: site.base },
        provenance: {
            parserVersion: MEDIAWIKI_MINI_DUMP_PARSER_VERSION_V1,
            canonicalizerVersion: MEDIAWIKI_MINI_DUMP_CANONICALIZER_VERSION_V1,
            imageDigests: [],
        },
        license: {
            licence: profile.license.licence,
            attributionTemplate: profile.license.attributionTemplate,
        },
        pages: sortedPages,
        contentDigest,
        authorityBoundary: MEDIAWIKI_MINI_DUMP_BOUNDARY_V1,
    };
    const editionDigest = sha256Canonical(unsigned);
    const edition = {
        ...unsigned,
        editionId: `mediawiki-mini-dump:${editionDigest.slice(0, 40)}`,
        priorEditionId: null,
        rawTransport: {
            sourcePath: profile.source.path,
            sourceChecksum: sha256Bytes(sourceBytes),
            byteSize: sourceBytes.byteLength,
        },
        editionDigest,
    };
    return deepFreeze(edition);
}
export function importMediaWikiMiniDumpEditionV1(rootInput, profileInput) {
    const profile = assertMediaWikiMiniDumpProfileV1(profileInput);
    if (profile.enabled !== true)
        throw new Error(ERROR_DISABLED);
    assertMediaWikiMiniDumpLicenceV1(profile);
    const root = path.resolve(rootInput);
    let rootStat;
    try {
        rootStat = lstatSync(root);
    }
    catch {
        throw new Error(ERROR_ROOT);
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
        throw new Error(ERROR_ROOT);
    if (realpathSync(root) !== root)
        throw new Error(ERROR_ROOT);
    const declaredSource = path.resolve(path.join(root, profile.source.path));
    if (!declaredSource.startsWith(root + path.sep))
        throw new Error(ERROR_PROFILE);
    try {
        lstatSync(declaredSource);
    }
    catch {
        throw new Error(ERROR_SOURCE);
    }
    // MWXML-M0-R010: the closed root admits only the declared .xml sources and JSON
    // manifest material; everything else (symlinks, directories, other kinds) denies.
    const xmlFiles = [];
    let entries;
    try {
        entries = readdirSync(root, { withFileTypes: true });
    }
    catch {
        throw new Error(ERROR_ROOT);
    }
    for (const entry of entries) {
        const absolute = path.join(root, entry.name);
        let stat;
        try {
            stat = lstatSync(absolute);
        }
        catch {
            throw new Error(ERROR_SOURCE);
        }
        if (entry.isSymbolicLink() || stat.isSymbolicLink() || !stat.isFile()) {
            throw new Error(ERROR_CLOSED_MANIFEST);
        }
        if (entry.name.endsWith(".xml")) {
            xmlFiles.push(entry.name);
        }
        else if (entry.name !== "manifest.json" && entry.name !== "negative-matrix.json") {
            throw new Error(ERROR_CLOSED_MANIFEST);
        }
    }
    if (canonicalJson([...xmlFiles].sort()) !== canonicalJson([...profile.xmlFiles].sort())) {
        throw new Error(ERROR_CLOSED_MANIFEST);
    }
    let raw;
    try {
        raw = readFileSync(declaredSource);
    }
    catch {
        throw new Error(ERROR_SOURCE);
    }
    return projectMediaWikiMiniDumpEditionV1(profile, new Uint8Array(raw));
}
const EDITION_KEYS = [
    "authorityBoundary",
    "contentDigest",
    "editionDigest",
    "editionId",
    "language",
    "license",
    "pages",
    "priorEditionId",
    "project",
    "provenance",
    "rawTransport",
    "schemaVersion",
    "site",
    "dump",
];
const PAGE_KEYS = [
    "canonicalTitle",
    "canonicalUrl",
    "chunks",
    "contentDigest",
    "licence",
    "namespace",
    "pageId",
    "project",
    "revisionId",
    "snapshotDate",
    "text",
    "timestamp",
    "title",
];
const CHUNK_KEYS = ["citation", "citationId", "chunkDigest", "endLine", "line", "startLine", "text"];
export function validateMediaWikiMiniDumpEditionV1(value) {
    if (!dataRecord(value) || !exactKeys(value, EDITION_KEYS))
        return false;
    const edition = value;
    if (edition.schemaVersion !== MEDIAWIKI_MINI_DUMP_EDITION_SCHEMA_V1)
        return false;
    if (edition.authorityBoundary !== MEDIAWIKI_MINI_DUMP_BOUNDARY_V1)
        return false;
    if (edition.priorEditionId !== null)
        return false;
    if (typeof edition.editionId !== "string" || !ID.test(edition.editionId))
        return false;
    if (typeof edition.project !== "string" || !ID.test(edition.project))
        return false;
    if (typeof edition.language !== "string" || !LANGUAGE.test(edition.language))
        return false;
    if (!dataRecord(edition.dump) || !exactKeys(edition.dump, ["kind", "snapshotDate", "sourceUrl"]))
        return false;
    const dump = edition.dump;
    if (dump.kind !== "CURRENT_PAGES_MINI_DUMP" ||
        typeof dump.sourceUrl !== "string" ||
        !SOURCE_URL.test(dump.sourceUrl) ||
        typeof dump.snapshotDate !== "string" ||
        !SNAPSHOT_DATE.test(dump.snapshotDate) ||
        !isValidCalendarDate(dump.snapshotDate)) {
        return false;
    }
    if (!dataRecord(edition.site) || !exactKeys(edition.site, ["base", "name"]))
        return false;
    const site = edition.site;
    if (typeof site.name !== "string" ||
        site.name.length < 1 ||
        site.name.length > 128 ||
        hasForbiddenTextCodePoint(site.name, false) ||
        typeof site.base !== "string" ||
        !SITE_BASE.test(site.base)) {
        return false;
    }
    if (!dataRecord(edition.rawTransport) ||
        !exactKeys(edition.rawTransport, ["byteSize", "sourceChecksum", "sourcePath"])) {
        return false;
    }
    const rawTransport = edition.rawTransport;
    if (typeof rawTransport.sourcePath !== "string" ||
        !SOURCE_PATH.test(rawTransport.sourcePath) ||
        typeof rawTransport.sourceChecksum !== "string" ||
        !DIGEST.test(rawTransport.sourceChecksum) ||
        !safeInteger(rawTransport.byteSize, 1) ||
        rawTransport.byteSize > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumSourceBytes) {
        return false;
    }
    if (!dataRecord(edition.provenance) || !exactKeys(edition.provenance, ["canonicalizerVersion", "imageDigests", "parserVersion"])) {
        return false;
    }
    const provenance = edition.provenance;
    if (provenance.parserVersion !== MEDIAWIKI_MINI_DUMP_PARSER_VERSION_V1 ||
        provenance.canonicalizerVersion !== MEDIAWIKI_MINI_DUMP_CANONICALIZER_VERSION_V1 ||
        !Array.isArray(provenance.imageDigests) ||
        provenance.imageDigests.length !== 0) {
        return false;
    }
    if (!dataRecord(edition.license) || !exactKeys(edition.license, ["attributionTemplate", "licence"]))
        return false;
    const license = edition.license;
    if (!isLicence(license.licence) ||
        typeof license.attributionTemplate !== "string" ||
        license.attributionTemplate.length < 1 ||
        license.attributionTemplate.length > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumAttributionTemplateCodeUnits) {
        return false;
    }
    if (!Array.isArray(edition.pages) || edition.pages.length < 1 || edition.pages.length > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumPages) {
        return false;
    }
    let totalLines = 0;
    const seenPageIds = new Set();
    const seenTitles = new Set();
    const seenRevisionIds = new Set();
    for (const rawPage of edition.pages) {
        if (!dataRecord(rawPage) || !exactKeys(rawPage, PAGE_KEYS))
            return false;
        const page = rawPage;
        if (page.namespace !== 0)
            return false;
        if (typeof page.title !== "string" ||
            page.title.length < 1 ||
            page.title.length > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumTitleCodeUnits ||
            hasForbiddenTextCodePoint(page.title, false) ||
            page.title.includes("<"))
            return false;
        if (page.canonicalTitle !== canonicalTitleOf(page.title))
            return false;
        if (typeof page.canonicalTitle !== "string" ||
            page.canonicalTitle.length < 1 ||
            page.canonicalTitle.length > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumTitleCodeUnits ||
            page.canonicalUrl !== canonicalUrlOf(site.base, page.canonicalTitle))
            return false;
        if (!safeInteger(page.pageId, 1) || !safeInteger(page.revisionId, 1))
            return false;
        if (seenPageIds.has(page.pageId) || seenTitles.has(page.title) || seenRevisionIds.has(page.revisionId))
            return false;
        seenPageIds.add(page.pageId);
        seenTitles.add(page.title);
        seenRevisionIds.add(page.revisionId);
        if (typeof page.timestamp !== "string" || !isValidTimestamp(page.timestamp))
            return false;
        if (page.project !== edition.project || page.snapshotDate !== dump.snapshotDate)
            return false;
        if (!isLicence(page.licence) || page.licence !== license.licence)
            return false;
        if (typeof page.text !== "string" ||
            page.text === "" ||
            hasForbiddenTextCodePoint(page.text, true) ||
            Buffer.byteLength(page.text, "utf8") > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumDecodedRevisionBytesPerPage) {
            return false;
        }
        if (typeof page.contentDigest !== "string" || !DIGEST.test(page.contentDigest))
            return false;
        const unsigned = {
            namespace: page.namespace,
            title: page.title,
            canonicalTitle: page.canonicalTitle,
            canonicalUrl: page.canonicalUrl,
            pageId: page.pageId,
            revisionId: page.revisionId,
            timestamp: page.timestamp,
            project: page.project,
            snapshotDate: page.snapshotDate,
            licence: page.licence,
            text: page.text,
        };
        if (pageContentDigestOf(unsigned) !== page.contentDigest)
            return false;
        if (!Array.isArray(page.chunks) || page.chunks.length === 0)
            return false;
        const expectedChunks = nonEmptyLines(page.text).map((item) => chunkUnsigned(page.canonicalTitle, item.line, item.text));
        if (expectedChunks.length !== page.chunks.length)
            return false;
        for (let index = 0; index < expectedChunks.length; index += 1) {
            const expected = expectedChunks[index];
            const actual = page.chunks[index];
            if (!dataRecord(actual) ||
                !exactKeys(actual, CHUNK_KEYS) ||
                !expected ||
                actual.citation !== expected.citation ||
                actual.citationId !== expected.citationId ||
                actual.line !== expected.line ||
                actual.startLine !== expected.startLine ||
                actual.endLine !== expected.endLine ||
                actual.text !== expected.text ||
                typeof actual.chunkDigest !== "string") {
                return false;
            }
            const digest = actual.chunkDigest;
            if (!DIGEST.test(digest) || sha256Canonical(expected) !== digest)
                return false;
        }
        totalLines += page.chunks.length;
    }
    if (totalLines > MEDIAWIKI_MINI_DUMP_M0_BOUNDS_V1.maximumProjectedNonEmptyLines)
        return false;
    for (let index = 1; index < edition.pages.length; index += 1) {
        const previous = edition.pages[index - 1];
        const current = edition.pages[index];
        if (!previous || !current || previous.title >= current.title)
            return false;
    }
    if (typeof edition.contentDigest !== "string" || !DIGEST.test(edition.contentDigest))
        return false;
    if (contentDigestOf(edition.pages) !== edition.contentDigest) {
        return false;
    }
    if (typeof edition.editionDigest !== "string" || !DIGEST.test(edition.editionDigest))
        return false;
    const digestInput = {
        schemaVersion: edition.schemaVersion,
        project: edition.project,
        language: edition.language,
        dump: edition.dump,
        site: edition.site,
        provenance: edition.provenance,
        license: edition.license,
        pages: edition.pages,
        contentDigest: edition.contentDigest,
        authorityBoundary: edition.authorityBoundary,
    };
    if (sha256Canonical(digestInput) !== edition.editionDigest)
        return false;
    if (edition.editionId !== `mediawiki-mini-dump:${edition.editionDigest.slice(0, 40)}`)
        return false;
    return true;
}

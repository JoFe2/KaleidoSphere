import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonical-json.js";
import { validateMediaWikiMiniDumpEditionV1, } from "./mediawiki-mini-dump.js";
/**
 * PSAI107 edition lifecycle.
 *
 * This is the filesystem-backed boundary for an already canonicalized,
 * immutable MediaWiki mini-dump edition. The lifecycle never downloads,
 * parses, executes, or mutates an edition. It only writes a closed manifest
 * and derived local index to an explicitly owned root, verifies both, and
 * replaces one active pointer atomically. The active pointer is the only
 * authority for reads; Accepted and LKG are digest bindings in that pointer.
 */
export const MEDIAWIKI_EDITION_LIFECYCLE_SCHEMA_V1 = "chimpmaera.knowledge/mediawiki-edition-lifecycle/v1";
export const MEDIAWIKI_EDITION_MANIFEST_SCHEMA_V1 = "chimpmaera.knowledge/mediawiki-edition-manifest/v1";
export const MEDIAWIKI_EDITION_INDEX_SCHEMA_V1 = "chimpmaera.knowledge/mediawiki-edition-index/v1";
export const MEDIAWIKI_EDITION_LIFECYCLE_ROOT_ENTRIES_V1 = Object.freeze([
    "active-index.json",
    "editions",
    "staging",
]);
const ACTIVE_INDEX_FILE = "active-index.json";
const EDITIONS_DIRECTORY = "editions";
const STAGING_DIRECTORY = "staging";
const MANIFEST_FILE = "manifest.json";
const INDEX_FILE = "index.json";
const DIGEST = /^[a-f0-9]{64}$/;
const STAGE_DIGEST = /^[a-f0-9]{64}$/;
const ERROR_PREFIX = "MEDIAWIKI_EDITION_LIFECYCLE_";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const digestOf = (value) => sha256(canonicalJson(value));
const exactKeys = (value, expected) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype)
        return false;
    const actual = Object.keys(value).sort();
    const keys = [...expected].sort();
    return actual.length === keys.length && actual.every((item, index) => item === keys[index]);
};
const dataRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
const isDigest = (value) => typeof value === "string" && DIGEST.test(value);
const isParentDigest = (value) => value === null || isDigest(value);
const safeInteger = (value) => Number.isSafeInteger(value) && value >= 1;
function fail(reason) {
    throw new Error(`${ERROR_PREFIX}${reason}`);
}
function resolvedRoot(rootInput) {
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
    if (!stat.isDirectory() || stat.isSymbolicLink())
        fail("ROOT_DENIED");
    let real;
    try {
        real = path.resolve(root, ".");
    }
    catch {
        fail("ROOT_DENIED");
    }
    if (real !== root)
        fail("ROOT_DENIED");
    try {
        if (realpathSync(root) !== root)
            fail("ROOT_DENIED");
    }
    catch {
        fail("ROOT_DENIED");
    }
    return root;
}
function ensureDirectory(root, name) {
    const target = path.join(root, name);
    let stat;
    try {
        stat = lstatSync(target);
    }
    catch {
        fail("ROOT_DENIED");
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
        fail("ROOT_DENIED");
    try {
        if (realpathSync(target) !== target)
            fail("ROOT_DENIED");
    }
    catch {
        fail("ROOT_DENIED");
    }
    return target;
}
function assertOwnedRoot(root, allowEmpty = false) {
    const resolved = resolvedRoot(root);
    const entries = readdirSync(resolved).sort();
    if (allowEmpty && entries.length === 0) {
        mkdirSync(path.join(resolved, EDITIONS_DIRECTORY));
        mkdirSync(path.join(resolved, STAGING_DIRECTORY));
    }
    const after = readdirSync(resolved).sort();
    if (after.some((entry) => !MEDIAWIKI_EDITION_LIFECYCLE_ROOT_ENTRIES_V1.includes(entry))) {
        fail("OWNERSHIP_DENIED");
    }
    const editions = ensureDirectory(resolved, EDITIONS_DIRECTORY);
    const staging = ensureDirectory(resolved, STAGING_DIRECTORY);
    return { root: resolved, editions, staging };
}
function assertInside(root, candidate) {
    const resolved = path.resolve(candidate);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
        fail("OWNERSHIP_DENIED");
    return resolved;
}
function assertSameVolume(left, right) {
    let leftStat;
    let rightStat;
    try {
        leftStat = statSync(left);
        rightStat = statSync(right);
    }
    catch {
        fail("CROSS_VOLUME_POINTER_DENIED");
    }
    if (leftStat.dev !== rightStat.dev)
        fail("CROSS_VOLUME_POINTER_DENIED");
}
function pointerPath(root, requested) {
    const target = requested === undefined ? path.join(root, ACTIVE_INDEX_FILE) : path.resolve(requested);
    assertInside(root, target);
    const parent = path.dirname(target);
    if (parent !== root)
        fail("OWNERSHIP_DENIED");
    assertSameVolume(root, parent);
    return target;
}
function manifestUnsigned(edition, parentEditionDigest) {
    return {
        schemaVersion: MEDIAWIKI_EDITION_MANIFEST_SCHEMA_V1,
        edition,
        parentEditionDigest,
    };
}
export function mediaWikiEditionManifestDigestV1(value) {
    return digestOf({
        schemaVersion: value.schemaVersion,
        edition: value.edition,
        parentEditionDigest: value.parentEditionDigest,
    });
}
function buildManifest(edition, parentEditionDigest) {
    const unsigned = manifestUnsigned(edition, parentEditionDigest);
    return { ...unsigned, manifestDigest: mediaWikiEditionManifestDigestV1(unsigned) };
}
function buildIndexUnsigned(edition, manifestDigest, acceptedEditionDigest, lastKnownGoodEditionDigest) {
    const entries = edition.pages.flatMap((page) => page.chunks.map((chunk) => ({
        editionDigest: edition.editionDigest,
        citationId: chunk.citationId,
        citation: chunk.citation,
        canonicalTitle: page.canonicalTitle,
        pageId: page.pageId,
        revisionId: page.revisionId,
        chunkDigest: chunk.chunkDigest,
        text: chunk.text,
    })));
    return {
        schemaVersion: MEDIAWIKI_EDITION_INDEX_SCHEMA_V1,
        activeEditionDigest: edition.editionDigest,
        acceptedEditionDigest,
        lastKnownGoodEditionDigest,
        manifestDigest,
        entries,
    };
}
export function mediaWikiEditionIndexDigestV1(value) {
    return digestOf({
        schemaVersion: value.schemaVersion,
        activeEditionDigest: value.activeEditionDigest,
        acceptedEditionDigest: value.acceptedEditionDigest,
        lastKnownGoodEditionDigest: value.lastKnownGoodEditionDigest,
        manifestDigest: value.manifestDigest,
        entries: value.entries,
    });
}
function buildIndex(edition, manifest, acceptedEditionDigest, lastKnownGoodEditionDigest) {
    const unsigned = buildIndexUnsigned(edition, manifest.manifestDigest, acceptedEditionDigest, lastKnownGoodEditionDigest);
    return { ...unsigned, indexDigest: mediaWikiEditionIndexDigestV1(unsigned) };
}
function candidateOf(input) {
    if (dataRecord(input) && "edition" in input && "parentEditionDigest" in input) {
        return input;
    }
    return { edition: input, parentEditionDigest: null };
}
function validateManifest(value) {
    return exactKeys(value, ["schemaVersion", "edition", "parentEditionDigest", "manifestDigest"])
        && value.schemaVersion === MEDIAWIKI_EDITION_MANIFEST_SCHEMA_V1
        && isParentDigest(value.parentEditionDigest)
        && validateMediaWikiMiniDumpEditionV1(value.edition)
        && isDigest(value.manifestDigest)
        && mediaWikiEditionManifestDigestV1(value) === value.manifestDigest;
}
function validIndexEntry(value, digest) {
    return exactKeys(value, [
        "editionDigest", "citationId", "citation", "canonicalTitle", "pageId", "revisionId", "chunkDigest", "text",
    ]) && value.editionDigest === digest
        && typeof value.citationId === "string" && /^citation:[a-f0-9]{24}$/.test(value.citationId)
        && typeof value.citation === "string" && /^.+#L[1-9][0-9]*$/.test(value.citation)
        && typeof value.canonicalTitle === "string" && value.canonicalTitle.length > 0
        && safeInteger(value.pageId) && safeInteger(value.revisionId)
        && isDigest(value.chunkDigest) && typeof value.text === "string" && value.text.length > 0;
}
function validateIndex(value) {
    if (!exactKeys(value, [
        "schemaVersion", "activeEditionDigest", "acceptedEditionDigest", "lastKnownGoodEditionDigest",
        "manifestDigest", "entries", "indexDigest",
    ]) || value.schemaVersion !== MEDIAWIKI_EDITION_INDEX_SCHEMA_V1
        || !isDigest(value.activeEditionDigest) || value.acceptedEditionDigest !== value.activeEditionDigest
        || !isDigest(value.lastKnownGoodEditionDigest) || !isDigest(value.manifestDigest)
        || !Array.isArray(value.entries) || value.entries.length < 1
        || !value.entries.every((entry) => validIndexEntry(entry, value.activeEditionDigest))
        || !isDigest(value.indexDigest))
        return false;
    return mediaWikiEditionIndexDigestV1(value) === value.indexDigest;
}
function parseJson(pathName) {
    try {
        return JSON.parse(readFileSync(pathName, "utf8"));
    }
    catch {
        fail("SCHEMA_DENIED");
    }
}
function readManifestAt(directory, digest) {
    if (!STAGE_DIGEST.test(digest))
        fail("MANIFEST_DENIED");
    const location = path.join(directory, digest, MANIFEST_FILE);
    let bytes;
    try {
        bytes = readFileSync(location);
    }
    catch {
        fail("MANIFEST_DENIED");
    }
    const parsed = parseJson(location);
    if (!validateManifest(parsed) || parsed.edition.editionDigest !== digest
        || canonicalJson(parsed) !== bytes.toString("utf8"))
        fail("MANIFEST_DENIED");
    return parsed;
}
function readIndexAt(location) {
    let bytes;
    try {
        bytes = readFileSync(location);
    }
    catch {
        fail("ACTIVE_INDEX_DENIED");
    }
    const parsed = parseJson(location);
    if (!validateIndex(parsed) || canonicalJson(parsed) !== bytes.toString("utf8"))
        fail("INDEX_DENIED");
    return parsed;
}
function assertRegularJsonFile(location, reason) {
    let stat;
    try {
        stat = lstatSync(location);
    }
    catch {
        fail(reason);
    }
    if (!stat.isFile() || stat.isSymbolicLink())
        fail(reason);
}
function validateIndexAgainstEdition(index, manifest) {
    const expected = buildIndex(manifest.edition, manifest, index.acceptedEditionDigest, index.lastKnownGoodEditionDigest);
    if (canonicalJson(expected) !== canonicalJson(index))
        fail("INDEX_DENIED");
}
function scanEditionDirectory(editions) {
    for (const entry of readdirSync(editions).sort()) {
        if (!STAGE_DIGEST.test(entry))
            fail("OWNERSHIP_DENIED");
        const directory = path.join(editions, entry);
        let stat;
        try {
            stat = lstatSync(directory);
        }
        catch {
            fail("OWNERSHIP_DENIED");
        }
        if (!stat.isDirectory() || stat.isSymbolicLink())
            fail("OWNERSHIP_DENIED");
        if (readdirSync(directory).sort().some((item) => item !== MANIFEST_FILE && item !== INDEX_FILE)) {
            fail("OWNERSHIP_DENIED");
        }
        assertRegularJsonFile(path.join(directory, MANIFEST_FILE), "OWNERSHIP_DENIED");
        if (existsSync(path.join(directory, INDEX_FILE))) {
            assertRegularJsonFile(path.join(directory, INDEX_FILE), "OWNERSHIP_DENIED");
        }
        readManifestAt(editions, entry);
    }
}
function scanStagingDirectory(staging) {
    const entries = readdirSync(staging).sort();
    for (const entry of entries) {
        if (!STAGE_DIGEST.test(entry))
            fail("OWNERSHIP_DENIED");
        const directory = path.join(staging, entry);
        let stat;
        try {
            stat = lstatSync(directory);
        }
        catch {
            fail("OWNERSHIP_DENIED");
        }
        if (!stat.isDirectory() || stat.isSymbolicLink())
            fail("OWNERSHIP_DENIED");
        const children = readdirSync(directory).sort();
        if (children.length !== 2 || children[0] !== INDEX_FILE || children[1] !== MANIFEST_FILE) {
            fail("OWNERSHIP_DENIED");
        }
        assertRegularJsonFile(path.join(directory, MANIFEST_FILE), "OWNERSHIP_DENIED");
        assertRegularJsonFile(path.join(directory, INDEX_FILE), "OWNERSHIP_DENIED");
    }
    return entries;
}
export function validateMediaWikiEditionActiveIndexV1(value) {
    return validateIndex(value);
}
export function readMediaWikiEditionLifecycleV1(rootInput) {
    const owned = assertOwnedRoot(rootInput);
    scanEditionDirectory(owned.editions);
    const staging = scanStagingDirectory(owned.staging);
    const location = path.join(owned.root, ACTIVE_INDEX_FILE);
    if (!existsSync(location))
        fail("ACTIVE_INDEX_DENIED");
    assertRegularJsonFile(location, "ACTIVE_INDEX_DENIED");
    const index = readIndexAt(location);
    const manifest = readManifestAt(owned.editions, index.activeEditionDigest);
    if (index.manifestDigest !== manifest.manifestDigest)
        fail("ACTIVE_INDEX_DENIED");
    validateIndexAgainstEdition(index, manifest);
    if (!existsSync(path.join(owned.editions, index.lastKnownGoodEditionDigest, MANIFEST_FILE))) {
        fail("ACTIVE_INDEX_DENIED");
    }
    for (const digest of staging)
        verifyStagedInternal(owned, { index, manifest }, digest);
    return { index, manifest };
}
function writeCanonical(location, value) {
    writeFileSync(location, canonicalJson(value), { encoding: "utf8", flag: "wx" });
}
function writeAtomically(root, destination, value) {
    const temporary = `${destination}.tmp`;
    if (existsSync(temporary))
        fail("OWNERSHIP_DENIED");
    assertSameVolume(root, path.dirname(destination));
    try {
        writeCanonical(temporary, value);
        renameSync(temporary, destination);
    }
    catch (error) {
        rmSync(temporary, { force: true });
        if (error instanceof Error && error.message.startsWith(ERROR_PREFIX))
            throw error;
        fail("ROLLBACK_FAILED");
    }
}
function writeEditionAtomically(editions, manifest, index) {
    const digest = manifest.edition.editionDigest;
    const finalDirectory = path.join(editions, digest);
    if (existsSync(finalDirectory))
        fail("DUPLICATE_ACTIVATION_DENIED");
    const temporary = path.join(editions, `.${digest}.tmp`);
    if (existsSync(temporary))
        fail("OWNERSHIP_DENIED");
    mkdirSync(temporary);
    try {
        writeCanonical(path.join(temporary, MANIFEST_FILE), manifest);
        writeCanonical(path.join(temporary, INDEX_FILE), index);
        renameSync(temporary, finalDirectory);
    }
    catch (error) {
        rmSync(temporary, { recursive: true, force: true });
        if (error instanceof Error && error.message.startsWith(ERROR_PREFIX))
            throw error;
        fail("ROLLBACK_FAILED");
    }
}
function validateCandidate(candidate, parentDigest) {
    if (!dataRecord(candidate) || !validateMediaWikiMiniDumpEditionV1(candidate.edition)
        || !isDigest(candidate.parentEditionDigest) || candidate.parentEditionDigest !== parentDigest) {
        fail(candidate.parentEditionDigest === parentDigest ? "SCHEMA_DENIED" : "STALE_PARENT_DENIED");
    }
    return buildManifest(candidate.edition, candidate.parentEditionDigest);
}
function stageInternal(owned, current, input) {
    if (scanStagingDirectory(owned.staging).length > 0)
        fail("INTERRUPTED_STAGE_DENIED");
    const candidate = candidateOf(input);
    const manifest = validateCandidate(candidate, current.index.activeEditionDigest);
    const digest = manifest.edition.editionDigest;
    if (existsSync(path.join(owned.editions, digest)))
        fail("DUPLICATE_ACTIVATION_DENIED");
    const index = buildIndex(manifest.edition, manifest, digest, current.index.activeEditionDigest);
    const directory = path.join(owned.staging, digest);
    mkdirSync(directory);
    try {
        writeCanonical(path.join(directory, MANIFEST_FILE), manifest);
        writeCanonical(path.join(directory, INDEX_FILE), index);
    }
    catch (error) {
        rmSync(directory, { recursive: true, force: true });
        if (error instanceof Error && error.message.startsWith(ERROR_PREFIX))
            throw error;
        fail("ROLLBACK_FAILED");
    }
    return { manifest, index, directory };
}
function verifyStagedInternal(owned, current, digest) {
    if (!STAGE_DIGEST.test(digest))
        fail("TAMPERED_STAGE_DENIED");
    const directory = path.join(owned.staging, digest);
    const manifestPath = path.join(directory, MANIFEST_FILE);
    const indexPath = path.join(directory, INDEX_FILE);
    const manifest = readManifestFromDirectory(directory, manifestPath, digest);
    const index = readIndexAt(indexPath);
    if (manifest.parentEditionDigest !== current.index.activeEditionDigest
        || index.activeEditionDigest !== digest
        || index.acceptedEditionDigest !== digest
        || index.lastKnownGoodEditionDigest !== current.index.activeEditionDigest
        || index.manifestDigest !== manifest.manifestDigest)
        fail("STALE_PARENT_DENIED");
    validateIndexAgainstEdition(index, manifest);
    return { manifest, index };
}
function readManifestFromDirectory(directory, location, digest) {
    let bytes;
    try {
        bytes = readFileSync(location);
    }
    catch {
        fail("TAMPERED_STAGE_DENIED");
    }
    const parsed = parseJson(location);
    if (!validateManifest(parsed) || parsed.edition.editionDigest !== digest
        || canonicalJson(parsed) !== bytes.toString("utf8"))
        fail("TAMPERED_STAGE_DENIED");
    return parsed;
}
function residue(owned) {
    return scanStagingDirectory(owned.staging);
}
function rollbackAfterSwitch(owned, oldIndexBytes, newDigest, destination) {
    try {
        const temporary = `${destination}.tmp`;
        if (existsSync(temporary))
            rmSync(temporary, { force: true });
        assertSameVolume(owned.root, path.dirname(destination));
        writeFileSync(temporary, oldIndexBytes, { flag: "wx" });
        renameSync(temporary, destination);
        rmSync(path.join(owned.editions, newDigest), { recursive: true, force: true });
        rmSync(path.join(owned.staging, newDigest), { recursive: true, force: true });
    }
    catch {
        fail("ROLLBACK_FAILED");
    }
}
export function initializeMediaWikiEditionLifecycleV1(rootInput, edition) {
    const owned = assertOwnedRoot(rootInput, true);
    if (readdirSync(owned.editions).length !== 0 || readdirSync(owned.staging).length !== 0
        || existsSync(path.join(owned.root, ACTIVE_INDEX_FILE)))
        fail("DUPLICATE_ACTIVATION_DENIED");
    if (!validateMediaWikiMiniDumpEditionV1(edition))
        fail("SCHEMA_DENIED");
    const manifest = buildManifest(edition, null);
    const index = buildIndex(edition, manifest, edition.editionDigest, edition.editionDigest);
    writeEditionAtomically(owned.editions, manifest, index);
    writeAtomically(owned.root, path.join(owned.root, ACTIVE_INDEX_FILE), index);
    return readMediaWikiEditionLifecycleV1(owned.root);
}
export function stageMediaWikiEditionV1(rootInput, input) {
    try {
        const owned = assertOwnedRoot(rootInput);
        const current = readMediaWikiEditionLifecycleV1(owned.root);
        const staged = stageInternal(owned, current, input);
        const verified = verifyStagedInternal(owned, current, staged.manifest.edition.editionDigest);
        if (verified.manifest.manifestDigest !== staged.manifest.manifestDigest)
            fail("TAMPERED_STAGE_DENIED");
        return {
            outcome: "STAGED",
            stagedEditionDigest: staged.manifest.edition.editionDigest,
            stagedResidue: [staged.manifest.edition.editionDigest],
        };
    }
    catch (error) {
        const reason = error instanceof Error && error.message.startsWith(ERROR_PREFIX)
            ? error.message.slice(ERROR_PREFIX.length)
            : "SCHEMA_DENIED";
        let activeEditionDigest = null;
        try {
            activeEditionDigest = readMediaWikiEditionLifecycleV1(rootInput).index.activeEditionDigest;
        }
        catch { /* fail closed */ }
        return {
            outcome: "DENIED",
            reason,
            activeEditionDigest,
            stagedResidue: [],
        };
    }
}
export function verifyMediaWikiEditionStageV1(rootInput, stagedEditionDigest) {
    try {
        const owned = assertOwnedRoot(rootInput);
        const current = readCurrentWithoutStaging(owned);
        const verified = verifyStagedInternal(owned, current, stagedEditionDigest);
        return {
            outcome: "STAGED",
            stagedEditionDigest: verified.manifest.edition.editionDigest,
            stagedResidue: [verified.manifest.edition.editionDigest],
        };
    }
    catch (error) {
        const reason = error instanceof Error && error.message.startsWith(ERROR_PREFIX)
            ? error.message.slice(ERROR_PREFIX.length)
            : "TAMPERED_STAGE_DENIED";
        return { outcome: "DENIED", reason, activeEditionDigest: null, stagedResidue: [] };
    }
}
export function activateMediaWikiEditionStageV1(rootInput, stagedEditionDigest, options = {}) {
    let owned;
    let destination;
    let oldIndexBytes;
    let promoted = false;
    try {
        owned = assertOwnedRoot(rootInput);
        destination = pointerPath(owned.root, options.activeIndexPath);
        oldIndexBytes = readFileSync(destination);
        const current = readCurrentWithoutStaging(owned);
        const verified = verifyStagedInternal(owned, current, stagedEditionDigest);
        if (options.injectFailureAt === "AFTER_STAGE")
            fail("INJECTED_FAILURE");
        renameSync(path.join(owned.staging, stagedEditionDigest), path.join(owned.editions, stagedEditionDigest));
        promoted = true;
        if (options.injectFailureAt === "AFTER_PROMOTE")
            fail("INJECTED_FAILURE");
        writeAtomically(owned.root, destination, verified.index);
        if (options.injectFailureAt === "AFTER_SWITCH")
            fail("INJECTED_FAILURE");
        const postcondition = readMediaWikiEditionLifecycleV1(owned.root);
        if (postcondition.index.activeEditionDigest !== stagedEditionDigest
            || postcondition.index.lastKnownGoodEditionDigest !== current.index.activeEditionDigest) {
            fail("INDEX_DENIED");
        }
        return {
            outcome: "ACTIVATED",
            activeEditionDigest: stagedEditionDigest,
            lastKnownGoodEditionDigest: current.index.activeEditionDigest,
            stagedResidue: [],
        };
    }
    catch (error) {
        let reason = error instanceof Error && error.message.startsWith(ERROR_PREFIX)
            ? error.message.slice(ERROR_PREFIX.length)
            : "SCHEMA_DENIED";
        let rollbackFailed = false;
        if (promoted && owned !== undefined && destination !== undefined && oldIndexBytes !== undefined) {
            try {
                rollbackAfterSwitch(owned, oldIndexBytes, stagedEditionDigest, destination);
            }
            catch {
                rollbackFailed = true;
                reason = "ROLLBACK_FAILED";
            }
        }
        let activeEditionDigest = null;
        try {
            activeEditionDigest = readCurrentWithoutStaging(owned).index.activeEditionDigest;
        }
        catch { /* fail closed */ }
        return {
            outcome: rollbackFailed || reason === "ROLLBACK_FAILED" ? "DENIED" : promoted ? "ROLLED_BACK" : "DENIED",
            reason,
            activeEditionDigest,
            stagedResidue: (() => {
                try {
                    return owned === undefined ? [] : residue(owned);
                }
                catch {
                    return [];
                }
            })(),
        };
    }
}
export const activateStagedMediaWikiEditionV1 = activateMediaWikiEditionStageV1;
function readCurrentWithoutStaging(owned) {
    const location = path.join(owned.root, ACTIVE_INDEX_FILE);
    const index = readIndexAt(location);
    const manifest = readManifestAt(owned.editions, index.activeEditionDigest);
    if (index.manifestDigest !== manifest.manifestDigest)
        fail("ACTIVE_INDEX_DENIED");
    validateIndexAgainstEdition(index, manifest);
    return { index, manifest };
}
export function activateMediaWikiEditionV1(rootInput, input, options = {}) {
    let owned;
    let destination;
    let oldIndexBytes;
    let newDigest;
    let promoted = false;
    try {
        owned = assertOwnedRoot(rootInput);
        destination = pointerPath(owned.root, options.activeIndexPath);
        oldIndexBytes = readFileSync(destination);
        const current = readMediaWikiEditionLifecycleV1(owned.root);
        const staged = stageInternal(owned, current, input);
        newDigest = staged.manifest.edition.editionDigest;
        const verified = verifyStagedInternal(owned, current, newDigest);
        if (options.injectFailureAt === "AFTER_STAGE") {
            rmSync(staged.directory, { recursive: true, force: true });
            return {
                outcome: "ROLLED_BACK",
                reason: "INJECTED_FAILURE",
                activeEditionDigest: current.index.activeEditionDigest,
                stagedResidue: [],
            };
        }
        const nextIndex = buildIndex(verified.manifest.edition, verified.manifest, newDigest, current.index.activeEditionDigest);
        if (options.injectFailureAt === "INTERRUPTED_STAGE") {
            // Leave the verified stage in the owned staging area while the active
            // pointer remains the old exact bytes. Recovery requires the explicit
            // residue cleaner; a normal read fails closed while it is present.
            return {
                outcome: "DENIED",
                reason: "INTERRUPTED_STAGE_DENIED",
                activeEditionDigest: current.index.activeEditionDigest,
                stagedResidue: [],
            };
        }
        renameSync(staged.directory, path.join(owned.editions, newDigest));
        promoted = true;
        if (options.injectFailureAt === "AFTER_PROMOTE")
            fail("INJECTED_FAILURE");
        writeAtomically(owned.root, destination, nextIndex);
        if (options.injectFailureAt === "AFTER_SWITCH")
            fail("INJECTED_FAILURE");
        const postcondition = readMediaWikiEditionLifecycleV1(owned.root);
        if (postcondition.index.activeEditionDigest !== newDigest
            || postcondition.index.lastKnownGoodEditionDigest !== current.index.activeEditionDigest) {
            fail("INDEX_DENIED");
        }
        return {
            outcome: "ACTIVATED",
            activeEditionDigest: newDigest,
            lastKnownGoodEditionDigest: current.index.activeEditionDigest,
            stagedResidue: [],
        };
    }
    catch (error) {
        let reason = error instanceof Error && error.message.startsWith(ERROR_PREFIX)
            ? error.message.slice(ERROR_PREFIX.length)
            : "SCHEMA_DENIED";
        let rollbackFailed = false;
        if (promoted && owned !== undefined && destination !== undefined && oldIndexBytes !== undefined && newDigest !== undefined) {
            try {
                rollbackAfterSwitch(owned, oldIndexBytes, newDigest, destination);
            }
            catch {
                rollbackFailed = true;
                reason = "ROLLBACK_FAILED";
            }
        }
        else if (owned !== undefined && newDigest !== undefined && reason !== "INTERRUPTED_STAGE_DENIED") {
            rmSync(path.join(owned.staging, newDigest), { recursive: true, force: true });
        }
        let activeEditionDigest = null;
        try {
            activeEditionDigest = readMediaWikiEditionLifecycleV1(rootInput).index.activeEditionDigest;
        }
        catch { /* fail closed */ }
        return {
            outcome: rollbackFailed || reason === "ROLLBACK_FAILED" ? "DENIED" : promoted ? "ROLLED_BACK" : "DENIED",
            reason,
            activeEditionDigest,
            stagedResidue: (() => {
                try {
                    return owned === undefined ? [] : residue(owned);
                }
                catch {
                    return [];
                }
            })(),
        };
    }
}
export function revokeMediaWikiEditionV1(rootInput) {
    try {
        const owned = assertOwnedRoot(rootInput);
        const current = readMediaWikiEditionLifecycleV1(owned.root);
        const lkg = readManifestAt(owned.editions, current.index.lastKnownGoodEditionDigest);
        if (current.index.activeEditionDigest === lkg.edition.editionDigest) {
            return {
                outcome: "DENIED",
                reason: "REVOKE_DENIED",
                activeEditionDigest: current.index.activeEditionDigest,
                stagedResidue: [],
            };
        }
        const restored = buildIndex(lkg.edition, lkg, lkg.edition.editionDigest, lkg.edition.editionDigest);
        writeAtomically(owned.root, path.join(owned.root, ACTIVE_INDEX_FILE), restored);
        const readback = readMediaWikiEditionLifecycleV1(owned.root);
        if (readback.index.activeEditionDigest !== lkg.edition.editionDigest
            || readback.index.lastKnownGoodEditionDigest !== lkg.edition.editionDigest)
            fail("REVOKE_DENIED");
        return {
            outcome: "ACTIVATED",
            activeEditionDigest: readback.index.activeEditionDigest,
            lastKnownGoodEditionDigest: readback.index.lastKnownGoodEditionDigest,
            stagedResidue: [],
        };
    }
    catch (error) {
        const reason = error instanceof Error && error.message.startsWith(ERROR_PREFIX)
            ? error.message.slice(ERROR_PREFIX.length)
            : "REVOKE_DENIED";
        return { outcome: "DENIED", reason, activeEditionDigest: null, stagedResidue: [] };
    }
}
export const rollbackMediaWikiEditionV1 = revokeMediaWikiEditionV1;
export function cleanupMediaWikiEditionResidueV1(rootInput) {
    try {
        const owned = assertOwnedRoot(rootInput);
        const entries = scanStagingDirectory(owned.staging);
        for (const digest of entries) {
            const directory = path.join(owned.staging, digest);
            const manifestPath = path.join(directory, MANIFEST_FILE);
            const indexPath = path.join(directory, INDEX_FILE);
            const manifest = readManifestFromDirectory(directory, manifestPath, digest);
            const index = readIndexAt(indexPath);
            if (index.activeEditionDigest !== digest || index.manifestDigest !== manifest.manifestDigest) {
                fail("TAMPERED_STAGE_DENIED");
            }
            validateIndexAgainstEdition(index, manifest);
            rmSync(directory, { recursive: true, force: true });
        }
        let activeEditionDigest = null;
        try {
            activeEditionDigest = readMediaWikiEditionLifecycleV1(owned.root).index.activeEditionDigest;
        }
        catch { /* empty roots remain denied */ }
        return {
            outcome: "CLEANED",
            activeEditionDigest: activeEditionDigest ?? "0".repeat(64),
            lastKnownGoodEditionDigest: activeEditionDigest ?? "0".repeat(64),
            stagedResidue: [],
        };
    }
    catch (error) {
        const reason = error instanceof Error && error.message.startsWith(ERROR_PREFIX)
            ? error.message.slice(ERROR_PREFIX.length)
            : "OWNERSHIP_DENIED";
        return { outcome: "DENIED", reason, activeEditionDigest: null, stagedResidue: [] };
    }
}
export const cleanMediaWikiEditionResidueV1 = cleanupMediaWikiEditionResidueV1;

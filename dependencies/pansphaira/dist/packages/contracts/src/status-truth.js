/**
 * PS380-STATUS-TRUTH-01 — canonical status-truth generator.
 *
 * A fail-closed, content-addressed contract for turning an *explicit,
 * allowlisted* issue/epic/release manifest plus an *anonymous provider
 * readback* into a bounded, deterministic public status snapshot.
 *
 * The generator never edits issues and never rewrites historical text. It
 * binds retrieval time, source URLs and exact state digests (each recomputed,
 * never trusted), projects the eight lifecycle stages with maturity
 * (planned / delivered / falsified), and fails on material contradictions
 * rather than silently repairing them:
 *
 *   - a closed issue shown as open/planned, an open acceptance shown complete,
 *     a missing required release/readback, a stale checklist, or a
 *     label/state disagreement;
 *   - a red, missing, stale or wrong-head *required* workflow can never
 *     project `closure verified` or `queue DONE`;
 *   - forward-only release / Latest reconciliation with the historical
 *     release body immutable;
 *   - partial provider data (incomplete pagination, missing allowlisted
 *     items, a tampered digest, or a broken retrieval binding) fails closed.
 *
 * Checkbox text is never stronger than provider state: a fully-checked
 * checklist alone can never upgrade an item's maturity or project a release /
 * DONE. The projection is a pure function of the (recomputed) snapshot state,
 * so roadmap / epic views can link or embed it instead of hand-maintained
 * closed-issue lists.
 */
import { createHash } from "node:crypto";
import { types } from "node:util";
import { canonicalJson } from "./canonical-json.js";
// ---------------------------------------------------------------------------
// Schema versions
// ---------------------------------------------------------------------------
export const STATUS_TRUTH_MANIFEST_SCHEMA_V1 = "ps380-status-truth-manifest.v1";
export const STATUS_TRUTH_READBACK_SCHEMA_V1 = "ps380-status-truth-readback.v1";
export const STATUS_TRUTH_SNAPSHOT_SCHEMA_V1 = "ps380-status-truth-snapshot.v1";
// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------
/**
 * The eight lifecycle stages, in their fixed projection order. A red,
 * missing, stale or wrong-head required workflow caps the last two projections
 * (`queueDone`, `closureVerified`) without rewriting the provider's truth.
 */
export const STATUS_TRUTH_LIFECYCLE_STAGES_V1 = [
    "codePresent",
    "testsPassed",
    "runtimeObserved",
    "merged",
    "released",
    "readbackVerified",
    "issueClosed",
    "queueDone",
];
/** Maturity is provider truth, never checkbox text. */
export const STATUS_TRUTH_MATURITIES_V1 = ["PLANNED", "DELIVERED", "FALSIFIED"];
/** A required workflow must be GREEN to let closure / DONE be projected. */
export const STATUS_TRUTH_WORKFLOW_STATES_V1 = [
    "GREEN",
    "RED",
    "MISSING",
    "STALE",
    "WRONG_HEAD",
    "NONE",
];
export const STATUS_TRUTH_ITEM_KINDS_V1 = ["ISSUE", "EPIC", "RELEASE"];
const CODE = {
    manifestSchema: "STATUS_TRUTH_MANIFEST_SCHEMA_DENIED",
    readbackSchema: "STATUS_TRUTH_READBACK_SCHEMA_DENIED",
    manifestDigest: "STATUS_TRUTH_MANIFEST_DIGEST_DENIED",
    readbackDigest: "STATUS_TRUTH_READBACK_DIGEST_DENIED",
    retrievalBinding: "STATUS_TRUTH_RETRIEVAL_BINDING_DENIED",
    releaseForwardOnly: "STATUS_TRUTH_RELEASE_FORWARD_ONLY_DENIED",
    releaseBodyMutation: "STATUS_TRUTH_RELEASE_BODY_MUTATION_DENIED",
    paginationIncomplete: "STATUS_TRUTH_PAGINATION_INCOMPLETE_DENIED",
    itemMismatch: "STATUS_TRUTH_ITEM_MISMATCH_DENIED",
    issueStateContradiction: "STATUS_TRUTH_ISSUE_STATE_CONTRADICTION_DENIED",
    acceptanceShownComplete: "STATUS_TRUTH_ACCEPTANCE_SHOWN_COMPLETE_DENIED",
    missingRelease: "STATUS_TRUTH_MISSING_RELEASE_DENIED",
    missingReadback: "STATUS_TRUTH_MISSING_READBACK_DENIED",
    checklistStale: "STATUS_TRUTH_CHECKLIST_STALE_DENIED",
    labelStateContradiction: "STATUS_TRUTH_LABEL_STATE_CONTRADICTION_DENIED",
    closureProjection: "STATUS_TRUTH_CLOSURE_PROJECTION_DENIED",
    projectionDigest: "STATUS_TRUTH_PROJECTION_DIGEST_DENIED",
};
const HEX64 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const ASCII_VISIBLE = /^[\x21-\x7E]+$/;
const HTTPS_URL = /^https:\/\/\S+$/;
const RELEASE_TAG = /^(\d{4})_(\d{2})_(\d{2})_v(\d+)$/;
function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        return false;
    if (types.isProxy(value))
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
/**
 * Reject non-plain prototypes, proxies, accessors, cycles and non-finite
 * numbers. Only deep-plain, finite JSON structures are admitted.
 */
function deepPlain(value, seen) {
    if (typeof value === "string" || typeof value === "boolean")
        return true;
    if (typeof value === "number")
        return Number.isFinite(value);
    if (value === null)
        return true;
    if (Array.isArray(value)) {
        if (seen.has(value))
            return false;
        seen.add(value);
        return value.every((entry) => deepPlain(entry, seen));
    }
    if (isPlainObject(value)) {
        if (seen.has(value))
            return false;
        seen.add(value);
        for (const key of Object.getOwnPropertyNames(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (descriptor !== undefined && (descriptor.get !== undefined || descriptor.set !== undefined)) {
                return false;
            }
        }
        return Object.values(value).every((entry) => deepPlain(entry, seen));
    }
    return false;
}
const digestHex = (value) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
function freeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const entry of Object.values(value))
            freeze(entry);
        Object.freeze(value);
    }
    return value;
}
function asExactRecord(value, keys) {
    if (!isPlainObject(value))
        return false;
    const actual = Object.keys(value).sort();
    return canonicalJson(actual) === canonicalJson([...keys].sort());
}
const isHex64 = (value) => typeof value === "string" && HEX64.test(value);
const isSha40 = (value) => typeof value === "string" && SHA40.test(value);
const isTimestamp = (value) => typeof value === "string" && RFC3339.test(value);
const isHttpsUrl = (value) => typeof value === "string" && HTTPS_URL.test(value);
const isBool = (value) => typeof value === "boolean";
const isInt = (value, min) => typeof value === "number" && Number.isInteger(value) && value >= min;
const isIdentifier = (value, max) => typeof value === "string" && value.length >= 1 && value.length <= max && ASCII_VISIBLE.test(value);
const isEnum = (value, members) => typeof value === "string" && members.includes(value);
function deny(defects) {
    return freeze({ outcome: "DENIED", reasonCodes: [...defects].sort() });
}
// ---------------------------------------------------------------------------
// Key sets
// ---------------------------------------------------------------------------
const MANIFEST_CORE_KEYS = ["manifestId", "retrieval", "items", "release"];
const RETRIEVAL_KEYS = ["retrievedAt", "sourceUrl", "organization", "repository"];
const MANIFEST_ITEM_KEYS = ["itemId", "kind", "issueNumber", "sourceUrl", "parentEpicId", "required"];
const REQUIRED_KEYS = ["releaseRequired", "readbackRequired", "workflowRequired"];
const MANIFEST_RELEASE_KEYS = ["releaseTag", "releaseUrl", "releaseBodyDigest"];
const READBACK_CORE_KEYS = ["readbackId", "retrieval", "pagination", "items", "release", "readback"];
const PAGINATION_KEYS = ["complete", "expectedItems", "observedItems"];
const READBACK_ITEM_KEYS = ["itemId", "issueNumber", "open", "labels", "checklist", "pr", "workflow", "maturity", "lifecycle"];
const CHECKLIST_KEYS = ["total", "checked"];
const PR_KEYS = ["number", "merged"];
const WORKFLOW_KEYS = ["required", "state", "headCommit", "runUrl"];
const LIFECYCLE_KEYS = STATUS_TRUTH_LIFECYCLE_STAGES_V1;
const READBACK_RELEASE_KEYS = ["latestTag", "releaseBodyDigest"];
const READBACK_RECEIPT_KEYS = ["readbackUrl", "readbackDigest", "readbackTimestamp"];
const SNAPSHOT_KEYS = [
    "schemaVersion",
    "manifestId",
    "readbackId",
    "retrieval",
    "manifestDigest",
    "readbackDigest",
    "stateDigest",
    "release",
    "items",
    "markdown",
    "snapshotDigest",
];
// ---------------------------------------------------------------------------
// Field validators
// ---------------------------------------------------------------------------
function validRetrieval(value) {
    return (asExactRecord(value, RETRIEVAL_KEYS) &&
        isTimestamp(value.retrievedAt) &&
        isHttpsUrl(value.sourceUrl) &&
        isIdentifier(value.organization, 64) &&
        isIdentifier(value.repository, 64));
}
function validManifestItem(value) {
    if (!asExactRecord(value, MANIFEST_ITEM_KEYS))
        return false;
    const item = value;
    const required = item.required;
    return (isIdentifier(item.itemId, 80) &&
        isEnum(item.kind, STATUS_TRUTH_ITEM_KINDS_V1) &&
        isInt(item.issueNumber, 0) &&
        isHttpsUrl(item.sourceUrl) &&
        (item.parentEpicId === null || isIdentifier(item.parentEpicId, 80)) &&
        asExactRecord(required, REQUIRED_KEYS) &&
        isBool(required.releaseRequired) &&
        isBool(required.readbackRequired) &&
        isBool(required.workflowRequired));
}
function validManifestCore(value) {
    if (!asExactRecord(value, MANIFEST_CORE_KEYS))
        return false;
    const manifest = value;
    const release = manifest.release;
    return (isIdentifier(manifest.manifestId, 80) &&
        validRetrieval(manifest.retrieval) &&
        Array.isArray(manifest.items) &&
        manifest.items.length >= 1 &&
        manifest.items.every(validManifestItem) &&
        asExactRecord(release, MANIFEST_RELEASE_KEYS) &&
        isIdentifier(release.releaseTag, 80) &&
        isHttpsUrl(release.releaseUrl) &&
        isHex64(release.releaseBodyDigest));
}
function validReadbackItem(value) {
    if (!asExactRecord(value, READBACK_ITEM_KEYS))
        return false;
    const item = value;
    const checklist = item.checklist;
    const pr = item.pr;
    const workflow = item.workflow;
    const lifecycle = item.lifecycle;
    const labels = item.labels;
    return (isIdentifier(item.itemId, 80) &&
        isInt(item.issueNumber, 0) &&
        isBool(item.open) &&
        Array.isArray(labels) &&
        labels.every((label) => isIdentifier(label, 64)) &&
        asExactRecord(checklist, CHECKLIST_KEYS) &&
        isInt(checklist.total, 0) &&
        isInt(checklist.checked, 0) &&
        checklist.checked <= checklist.total &&
        asExactRecord(pr, PR_KEYS) &&
        isInt(pr.number, 0) &&
        isBool(pr.merged) &&
        asExactRecord(workflow, WORKFLOW_KEYS) &&
        isBool(workflow.required) &&
        isEnum(workflow.state, STATUS_TRUTH_WORKFLOW_STATES_V1) &&
        (isSha40(workflow.headCommit) || workflow.headCommit === null) &&
        (isHttpsUrl(workflow.runUrl) || workflow.runUrl === null) &&
        isEnum(item.maturity, STATUS_TRUTH_MATURITIES_V1) &&
        asExactRecord(lifecycle, LIFECYCLE_KEYS) &&
        LIFECYCLE_KEYS.every((key) => isBool(lifecycle[key])));
}
function validReadbackCore(value) {
    if (!asExactRecord(value, READBACK_CORE_KEYS))
        return false;
    const readback = value;
    const pagination = readback.pagination;
    const release = readback.release;
    const receipt = readback.readback;
    return (isIdentifier(readback.readbackId, 80) &&
        validRetrieval(readback.retrieval) &&
        asExactRecord(pagination, PAGINATION_KEYS) &&
        isBool(pagination.complete) &&
        isInt(pagination.expectedItems, 0) &&
        isInt(pagination.observedItems, 0) &&
        Array.isArray(readback.items) &&
        readback.items.every(validReadbackItem) &&
        asExactRecord(release, READBACK_RELEASE_KEYS) &&
        isIdentifier(release.latestTag, 80) &&
        isHex64(release.releaseBodyDigest) &&
        asExactRecord(receipt, READBACK_RECEIPT_KEYS) &&
        isHttpsUrl(receipt.readbackUrl) &&
        // A real anonymous provider readback is digested; "NONE" is not a digest.
        isHex64(receipt.readbackDigest) &&
        isTimestamp(receipt.readbackTimestamp));
}
// ---------------------------------------------------------------------------
// Forward-only release / Latest comparison
// ---------------------------------------------------------------------------
function tagKey(tag) {
    const match = RELEASE_TAG.exec(tag);
    if (match === null)
        return null;
    const date = Number(`${match[1]}${match[2]}${match[3]}`);
    const version = Number(match[4]);
    return [date, version];
}
/**
 * Forward-only reconciliation: the provider's Latest release must be the same
 * as, or newer than, the scoped release. Unknown ordering is not forward.
 */
function compareTags(latest, scoped) {
    const a = tagKey(latest);
    const b = tagKey(scoped);
    if (a === null || b === null)
        return -1;
    if (a[0] !== b[0])
        return a[0] < b[0] ? -1 : 1;
    if (a[1] !== b[1])
        return a[1] < b[1] ? -1 : 1;
    return 0;
}
function normalizeManifest(arg) {
    if (!deepPlain(arg, new Set()))
        return { ok: false, code: CODE.manifestSchema };
    const record = arg;
    const hasDigest = Object.prototype.hasOwnProperty.call(record, "manifestDigest");
    const body = hasDigest ? { ...record } : { ...record, schemaVersion: STATUS_TRUTH_MANIFEST_SCHEMA_V1 };
    if (hasDigest)
        delete body.manifestDigest;
    const core = { ...body };
    delete core.schemaVersion;
    if (!validManifestCore(core))
        return { ok: false, code: CODE.manifestSchema };
    const digest = digestHex(body);
    if (hasDigest && record.manifestDigest !== digest)
        return { ok: false, code: CODE.manifestDigest };
    return { ok: true, body, digest };
}
function normalizeReadback(arg) {
    if (!deepPlain(arg, new Set()))
        return { ok: false, code: CODE.readbackSchema };
    const record = arg;
    const hasDigest = Object.prototype.hasOwnProperty.call(record, "readbackDigest");
    const body = hasDigest ? { ...record } : { ...record, schemaVersion: STATUS_TRUTH_READBACK_SCHEMA_V1 };
    if (hasDigest)
        delete body.readbackDigest;
    const core = { ...body };
    delete core.schemaVersion;
    if (!validReadbackCore(core))
        return { ok: false, code: CODE.readbackSchema };
    const digest = digestHex(body);
    if (hasDigest && record.readbackDigest !== digest)
        return { ok: false, code: CODE.readbackDigest };
    return { ok: true, body, digest };
}
// ---------------------------------------------------------------------------
// Per-item contradiction analysis
// ---------------------------------------------------------------------------
const LABEL_MATURITY = new Map([
    ["delivered", "DELIVERED"],
    ["planned", "PLANNED"],
    ["falsified", "FALSIFIED"],
]);
function analyzeItem(itemId, readbackItem, manifestRequired, defects) {
    if (manifestRequired === undefined) {
        defects.add(CODE.itemMismatch);
        return;
    }
    const lifecycle = readbackItem.lifecycle;
    const workflow = readbackItem.workflow;
    const checklist = readbackItem.checklist;
    const labels = readbackItem.labels;
    const maturity = readbackItem.maturity;
    const gateBlocked = workflow.required === true && workflow.state !== "GREEN";
    const gateGreen = !gateBlocked;
    const claimsComplete = maturity === "DELIVERED" || lifecycle.queueDone === true;
    // A red / missing / stale / wrong-head required workflow can never back a
    // provider claim of DONE.
    if (gateBlocked && lifecycle.queueDone === true)
        defects.add(CODE.closureProjection);
    // Open acceptance shown complete: DELIVERED but the queue is not DONE, over a
    // green gate (a red gate explains the not-done and is handled above).
    if (maturity === "DELIVERED" && lifecycle.queueDone === false && gateGreen) {
        defects.add(CODE.acceptanceShownComplete);
    }
    // Issue state contradiction: the provider's `open` / maturity disagrees with
    // the lifecycle truth.
    if (readbackItem.open === true && (lifecycle.issueClosed === true || maturity === "DELIVERED")) {
        defects.add(CODE.issueStateContradiction);
    }
    if (maturity === "PLANNED" && (lifecycle.issueClosed === true || lifecycle.queueDone === true)) {
        defects.add(CODE.issueStateContradiction);
    }
    // A complete item must carry its required release / readback.
    if (claimsComplete && manifestRequired.releaseRequired === true && lifecycle.released === false) {
        defects.add(CODE.missingRelease);
    }
    if (claimsComplete && manifestRequired.readbackRequired === true && lifecycle.readbackVerified === false) {
        defects.add(CODE.missingReadback);
    }
    // A delivered item with an incomplete checklist is stale.
    if (maturity === "DELIVERED" && checklist.checked < checklist.total) {
        defects.add(CODE.checklistStale);
    }
    // A label that disagrees with maturity is a state disagreement.
    for (const label of labels) {
        const expected = LABEL_MATURITY.get(label.toLowerCase());
        if (expected !== undefined && expected !== maturity) {
            defects.add(CODE.labelStateContradiction);
            break;
        }
    }
}
// ---------------------------------------------------------------------------
// Projection + deterministic markdown
// ---------------------------------------------------------------------------
function buildProjection(lifecycle, workflow) {
    const gateBlocked = workflow.required === true && workflow.state !== "GREEN";
    const projection = {};
    for (const stage of STATUS_TRUTH_LIFECYCLE_STAGES_V1) {
        projection[stage] =
            stage === "queueDone"
                ? lifecycle.queueDone === true && !gateBlocked
                : lifecycle[stage] === true;
    }
    projection.closureVerified = lifecycle.issueClosed === true && !gateBlocked;
    return projection;
}
function renderMarkdown(retrieval, scopedRelease, readbackRelease, forwardOnly, items, stateDigest) {
    const lines = [];
    lines.push("# Status Truth — PS380-STATUS-TRUTH-01");
    lines.push("");
    lines.push(`Retrieved: ${retrieval.retrievedAt}`);
    lines.push(`Source: ${retrieval.sourceUrl}`);
    lines.push(`Scoped release: ${scopedRelease.releaseTag}`);
    lines.push(`Latest: ${readbackRelease.latestTag} (forward-only: ${forwardOnly ? "yes" : "no"})`);
    lines.push(`State digest: ${stateDigest}`);
    lines.push("");
    for (const item of items) {
        const projection = item.projection;
        const checklist = item.checklist;
        const pr = item.pr;
        const labels = item.labels;
        lines.push(`## ${item.itemId} — ${item.maturity}`);
        lines.push(`- open: ${item.issueOpen === true ? "yes" : "no"}`);
        lines.push(`- checklist: ${checklist.checked}/${checklist.total}`);
        lines.push(`- labels: ${labels.map(String).join(", ") || "none"}`);
        lines.push(`- pr: #${pr.number} merged=${pr.merged === true ? "yes" : "no"}`);
        const badges = [];
        for (const stage of STATUS_TRUTH_LIFECYCLE_STAGES_V1) {
            if (projection[stage] === true)
                badges.push(stage);
        }
        if (projection.closureVerified === true)
            badges.push("closure-verified");
        lines.push(`- stages: ${badges.join(", ") || "none"}`);
        lines.push(`- projection digest: ${item.projectionDigest}`);
        lines.push("");
    }
    return lines.join("\n");
}
// ---------------------------------------------------------------------------
// Build / generate / verify
// ---------------------------------------------------------------------------
export function createStatusTruthManifestV1(input) {
    const defects = new Set();
    if (!deepPlain(input, new Set()) || !validManifestCore(input)) {
        defects.add(CODE.manifestSchema);
        return deny(defects);
    }
    const body = freeze({ schemaVersion: STATUS_TRUTH_MANIFEST_SCHEMA_V1, ...input });
    const manifest = freeze({ ...body, manifestDigest: digestHex(body) });
    return freeze({ outcome: "BUILT", manifest });
}
export function createStatusTruthProviderReadbackV1(input) {
    const defects = new Set();
    if (!deepPlain(input, new Set()) || !validReadbackCore(input)) {
        defects.add(CODE.readbackSchema);
        return deny(defects);
    }
    const body = freeze({ schemaVersion: STATUS_TRUTH_READBACK_SCHEMA_V1, ...input });
    const readback = freeze({ ...body, readbackDigest: digestHex(body) });
    return freeze({ outcome: "BUILT", readback });
}
export function generateStatusTruthSnapshotV1(manifestArg, readbackArg) {
    const defects = new Set();
    const manifest = normalizeManifest(manifestArg);
    const readback = normalizeReadback(readbackArg);
    if (!manifest.ok)
        defects.add(manifest.code);
    if (!readback.ok)
        defects.add(readback.code);
    if (defects.size > 0)
        return deny(defects);
    const m = manifest;
    const r = readback;
    // AC01: a single retrieval binding ties manifest and readback together.
    if (canonicalJson(m.body.retrieval) !== canonicalJson(r.body.retrieval)) {
        defects.add(CODE.retrievalBinding);
    }
    const scopedRelease = m.body.release;
    const readbackRelease = r.body.release;
    // Immutable historical release body; a mutated digest fails closed.
    if (scopedRelease.releaseBodyDigest !== readbackRelease.releaseBodyDigest) {
        defects.add(CODE.releaseBodyMutation);
    }
    // Forward-only release / Latest reconciliation.
    const forwardOnly = compareTags(readbackRelease.latestTag, scopedRelease.releaseTag) >= 0;
    if (!forwardOnly)
        defects.add(CODE.releaseForwardOnly);
    // AC06: pagination / completeness.
    const pagination = r.body.pagination;
    if (pagination.complete !== true || pagination.expectedItems !== pagination.observedItems) {
        defects.add(CODE.paginationIncomplete);
    }
    // Allowlisted item set must match the observed set exactly.
    const manifestIds = m.body.items.map((item) => item.itemId);
    const readbackIds = r.body.items.map((item) => item.itemId);
    const manifestSet = new Set(manifestIds);
    const readbackSet = new Set(readbackIds);
    if (manifestSet.size !== readbackSet.size || ![...manifestSet].every((id) => readbackSet.has(id))) {
        defects.add(CODE.itemMismatch);
    }
    // Per-item material-contradiction analysis.
    const manifestById = new Map();
    for (const item of m.body.items)
        manifestById.set(item.itemId, item);
    const readbackById = new Map();
    for (const item of r.body.items)
        readbackById.set(item.itemId, item);
    for (const [itemId, readbackItem] of readbackById) {
        const manifestItem = manifestById.get(itemId);
        analyzeItem(itemId, readbackItem, manifestItem?.required, defects);
    }
    if (defects.size > 0)
        return deny(defects);
    // Build the snapshot items and their per-item projection digests.
    const snapshotItems = [];
    for (const readbackItem of r.body.items) {
        const manifestItem = manifestById.get(readbackItem.itemId);
        const projection = buildProjection(readbackItem.lifecycle, readbackItem.workflow);
        snapshotItems.push({
            itemId: readbackItem.itemId,
            issueNumber: readbackItem.issueNumber,
            sourceUrl: manifestItem?.sourceUrl ?? "",
            issueOpen: readbackItem.open,
            labels: [...readbackItem.labels],
            checklist: {
                total: readbackItem.checklist.total,
                checked: readbackItem.checklist.checked,
            },
            pr: {
                number: readbackItem.pr.number,
                merged: readbackItem.pr.merged,
            },
            maturity: readbackItem.maturity,
            projection,
            projectionDigest: digestHex(projection),
        });
    }
    // Exact state digest: the projected view, not the whole record.
    const stateView = snapshotItems.map((item) => ({
        itemId: item.itemId,
        issueOpen: item.issueOpen,
        checklist: item.checklist,
        labels: item.labels,
        pr: item.pr,
        maturity: item.maturity,
        projection: item.projection,
    }));
    const stateDigest = digestHex(stateView);
    const markdown = renderMarkdown(m.body.retrieval, scopedRelease, readbackRelease, forwardOnly, snapshotItems, stateDigest);
    const snapshotBody = {
        schemaVersion: STATUS_TRUTH_SNAPSHOT_SCHEMA_V1,
        manifestId: m.body.manifestId,
        readbackId: r.body.readbackId,
        retrieval: m.body.retrieval,
        manifestDigest: m.digest,
        readbackDigest: r.digest,
        stateDigest,
        release: {
            releaseTag: scopedRelease.releaseTag,
            latestTag: readbackRelease.latestTag,
            releaseBodyDigest: scopedRelease.releaseBodyDigest,
            forwardOnly,
        },
        items: snapshotItems,
        markdown,
    };
    const snapshot = freeze({ ...snapshotBody, snapshotDigest: digestHex(snapshotBody) });
    return freeze({ outcome: "GENERATED", snapshot });
}
export function verifyStatusTruthSnapshotV1(snapshot, expected) {
    const defects = new Set();
    if (!deepPlain(snapshot, new Set()) || !asExactRecord(snapshot, SNAPSHOT_KEYS)) {
        defects.add(CODE.projectionDigest);
        return deny(defects);
    }
    const record = snapshot;
    if (record.schemaVersion !== STATUS_TRUTH_SNAPSHOT_SCHEMA_V1) {
        defects.add(CODE.projectionDigest);
        return deny(defects);
    }
    if (!asExactRecord(expected, ["stateDigest", "snapshotDigest"]) ||
        !isHex64(expected.stateDigest) ||
        !isHex64(expected.snapshotDigest)) {
        defects.add(CODE.projectionDigest);
        return deny(defects);
    }
    const exp = expected;
    // Recompute the state digest from the projected item view — never trusted.
    const stateView = record.items.map((item) => ({
        itemId: item.itemId,
        issueOpen: item.issueOpen,
        checklist: item.checklist,
        labels: item.labels,
        pr: item.pr,
        maturity: item.maturity,
        projection: item.projection,
    }));
    const recomputedStateDigest = digestHex(stateView);
    if (recomputedStateDigest !== exp.stateDigest || recomputedStateDigest !== record.stateDigest) {
        defects.add(CODE.projectionDigest);
        return deny(defects);
    }
    // Recompute the snapshot digest over the whole body — never trusted.
    const body = { ...record };
    delete body.snapshotDigest;
    if (digestHex(body) !== exp.snapshotDigest || digestHex(body) !== record.snapshotDigest) {
        defects.add(CODE.projectionDigest);
        return deny(defects);
    }
    // Recompute each item's projection digest.
    for (const item of record.items) {
        if (digestHex(item.projection) !== item.projectionDigest) {
            defects.add(CODE.projectionDigest);
            return deny(defects);
        }
    }
    return freeze({ outcome: "VERIFIED" });
}

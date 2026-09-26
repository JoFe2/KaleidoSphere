// KS254 (JoFe2/KaleidoSphere#254) — crash-safe projection/receipt generation activation.
//
// The native bi-control path derives two artifacts from one analysis: the read-only
// projection database (`analytics.db`, consumed by the Superset materializer) and the
// receipt JSON (`latest.json` / `<receiptId>.json`, the analysis evidence). They are ONE
// generation: a reader must never see the new projection beside the old receipt.
//
// Previously the projection was renamed into place and the receipts were then written
// separately with plain `writeFile` calls, so an interruption between them left a MIXED
// generation, and an interruption during a receipt write left a truncated pointer.
//
// Now the pair is staged together, verified against its own manifest, published as an
// immutable content-addressed generation directory, and committed by ONE atomic pointer
// flip. The fixed `PROJECTION_DB` path and the legacy `latest.json` / `<receiptId>.json`
// paths are written afterwards as mirrors, each by an atomic `rename(2)`, so they carry a
// COMPLETE generation at all times — at worst the previous one. A reader that needs the
// exact generation resolves it through the pointer; a digest-checked consumer (the Superset
// materializer's `SUPERSET_PROJECTION_DIGEST_MISMATCH`) refuses a lagging mirror instead of
// binding mixed evidence.
//
// Non-claim: real interrupts are process deaths (SIGKILL); storage power loss is not claimed.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { ingestCatalogReceipt } from './catalog.mjs';
import {
  activateGeneration, cleanupGenerationStore, cleanupPointerDebris, generationStoreLayout,
  inspectGenerationStore, readActiveGeneration, recoverGenerationStore, stageGeneration,
  GENERATION_STORE_CONTRACT,
} from './generation-store.mjs';

export const PROJECTION_GENERATION_CONTRACT = 'chimpmaera.bi/projection-generation/v1';
export const PROJECTION_FILE = 'analytics.db';
export const RECEIPT_FILE = 'receipt.json';
export const LEGACY_POINTER_FILE = 'latest.json';
export const PROJECTION_TABLES = Object.freeze(['bi_analysis_summary', 'bi_analysis_detail']);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code, detail = null) => {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  if (detail !== null) error.detail = detail;
  throw error;
};

const atomicWrite = (file, bytes, { mode = 0o600 } = {}) => {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.ks254-${process.pid}-${Math.random().toString(16).slice(2, 10)}.tmp`;
  writeFileSync(temporary, bytes, { mode });
  renameSync(temporary, file);
};

// The native projection builder: the read-only analysis projection for ONE receipt, carrying
// the materialized overview tables and the M3 technical catalog generation for the same
// snapshot. Kept byte-for-byte equivalent to the previous `writeProjection` construction.
export function buildProjectionDatabase(databasePath, receipt) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE bi_analysis_summary (
        receipt_id TEXT PRIMARY KEY, source_engine TEXT NOT NULL, source_database TEXT NOT NULL, source_mode TEXT NOT NULL,
        runtime_validation TEXT NOT NULL, status TEXT NOT NULL, analyzed_at TEXT NOT NULL,
        relation_count INTEGER NOT NULL, column_count INTEGER NOT NULL,
        constraint_count INTEGER NOT NULL, index_count INTEGER NOT NULL,
        snapshot_sha256 TEXT NOT NULL UNIQUE, source_read_only INTEGER NOT NULL CHECK(source_read_only=1)
      );
      CREATE TABLE bi_analysis_detail (
        row_id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL, schema_name TEXT NOT NULL,
        relation_name TEXT NOT NULL, relation_kind TEXT NOT NULL, column_name TEXT NOT NULL,
        data_type TEXT NOT NULL, ordinal_position INTEGER NOT NULL, is_nullable INTEGER NOT NULL,
        FOREIGN KEY(receipt_id) REFERENCES bi_analysis_summary(receipt_id)
      );`);
    const rows = (queryId) => receipt.analysis.extracts.find((entry) => entry.queryId === queryId)?.rows ?? [];
    const relations = rows(`${receipt.engine}.structure.relations`);
    const columns = rows(`${receipt.engine}.structure.columns`);
    const constraints = rows(`${receipt.engine}.structure.constraints`);
    const indexes = rows(`${receipt.engine}.structure.indexes`);
    database.prepare('INSERT INTO bi_analysis_summary VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(receipt.receiptId, receipt.engine, receipt.scope.database, receipt.sourceMode, receipt.analysis.runtimeValidation,
        receipt.status, receipt.analyzedAt, relations.length, columns.length, constraints.length, indexes.length,
        receipt.analysis.snapshotSha256, 1);
    const relationKinds = new Map(relations.map((row) => [`${row.schema_name}.${row.relation_name}`, row.relation_kind]));
    const statement = database.prepare('INSERT INTO bi_analysis_detail VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const column of columns) {
      const rowId = sha256(`${receipt.receiptId}:${column.schema_name}:${column.relation_name}:${column.column_name}`);
      statement.run(rowId, receipt.receiptId, column.schema_name, column.relation_name,
        relationKinds.get(`${column.schema_name}.${column.relation_name}`) ?? column.relation_kind ?? 'UNKNOWN',
        column.column_name, column.data_type, Number(column.ordinal_position), column.is_nullable ? 1 : 0);
    }
    ingestCatalogReceipt(database, receipt);
  } finally {
    database.close();
  }
  return databasePath;
}

export function projectionGenerationLayout(receiptDir) {
  const store = generationStoreLayout(receiptDir);
  return {
    receiptDir: path.resolve(receiptDir),
    store,
    latestPointer: path.resolve(receiptDir, LEGACY_POINTER_FILE),
  };
}

// Stage the projection AND its receipt as ONE generation, with the receipt's own declared
// `projection.sha256` bound to the exact projection bytes staged beside it.
export function stageProjectionGeneration({ receiptDir, receipt, target = 'projection' }) {
  if (!receipt?.receiptId || !receipt?.analysis?.snapshotSha256) fail('PROJECTION_RECEIPT_INVALID');
  const staged = stageGeneration({
    root: receiptDir,
    target,
    build: (stagingDirectory) => {
      const projectionPath = path.join(stagingDirectory, PROJECTION_FILE);
      buildProjectionDatabase(projectionPath, receipt);
      const projectionSha256 = sha256(readFileSync(projectionPath));
      const completeReceipt = {
        ...receipt,
        projection: { path: PROJECTION_FILE, sha256: projectionSha256, tables: [...PROJECTION_TABLES] },
      };
      const receiptBytes = Buffer.from(`${JSON.stringify(completeReceipt, null, 2)}\n`);
      writeFileSync(path.join(stagingDirectory, RECEIPT_FILE), receiptBytes, { mode: 0o600 });
      return {
        label: `receipt:${completeReceipt.receiptId}`,
        files: [
          { path: PROJECTION_FILE, sha256: projectionSha256 },
          { path: RECEIPT_FILE, sha256: sha256(receiptBytes) },
        ],
        extra: { receipt: completeReceipt, projectionSha256, receiptBytes },
      };
    },
  });
  return staged;
}

// Commit the staged generation, then refresh the mirrors. The pointer flip is the single
// commit point; the mirrors are written after it and are each individually atomic.
export function activateProjectionGeneration({ receiptDir, staged, projectionDb, target = 'projection' }) {
  const activated = activateGeneration({ root: receiptDir, staged, target });
  const generationReceipt = JSON.parse(readFileSync(path.join(activated.generationPath, RECEIPT_FILE), 'utf8'));
  const mirror = mirrorActiveProjectionGeneration({ receiptDir, projectionDb });
  const receiptBytes = readFileSync(path.join(activated.generationPath, RECEIPT_FILE));
  atomicWrite(path.join(receiptDir, `${generationReceipt.receiptId}.json`), receiptBytes);
  atomicWrite(path.join(receiptDir, LEGACY_POINTER_FILE), receiptBytes);
  return {
    generationId: activated.generationId,
    generationPath: activated.generationPath,
    published: activated.published,
    receipt: generationReceipt,
    projectionSha256: generationReceipt.projection.sha256,
    mirror,
  };
}

// Copy the ACTIVE generation's projection to the fixed `PROJECTION_DB` path through a
// unique temporary and an atomic rename, so that path always holds a complete projection.
export function mirrorActiveProjectionGeneration({ receiptDir, projectionDb }) {
  const active = readActiveGeneration({ root: receiptDir, verifyFiles: true });
  if (!active.ok) fail('PROJECTION_GENERATION_UNRESOLVED', active.code);
  const bytes = readFileSync(path.join(active.generationPath, PROJECTION_FILE));
  const sha256Value = sha256(bytes);
  atomicWrite(path.resolve(projectionDb), bytes);
  return {
    path: path.resolve(projectionDb),
    sha256: sha256Value,
    generationId: active.generationId,
    inSync: true,
  };
}

// Readback of the ACTIVE generation. The receipt and the projection are taken from the SAME
// immutable generation directory and both digests are re-verified, so a mixed result is not
// representable: an unresolved or incomplete pointer fails closed instead.
export function readActiveProjectionGeneration({ receiptDir, verifyProjection = true }) {
  const layout = projectionGenerationLayout(receiptDir);
  const active = readActiveGeneration({ root: receiptDir, verifyFiles: verifyProjection });
  if (!active.ok) {
    return { ok: false, state: active.state, code: active.code, layout, mismatches: active.mismatches ?? null };
  }
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path.join(active.generationPath, RECEIPT_FILE), 'utf8'));
  } catch {
    return { ok: false, state: 'INCOMPLETE', code: 'PROJECTION_RECEIPT_UNREADABLE', layout };
  }
  if (!receipt?.projection?.sha256 || receipt.receiptId === undefined) {
    return { ok: false, state: 'INCOMPLETE', code: 'PROJECTION_RECEIPT_UNBOUND', layout };
  }
  if (verifyProjection) {
    const actual = sha256(readFileSync(path.join(active.generationPath, PROJECTION_FILE)));
    if (actual !== receipt.projection.sha256) {
      return {
        ok: false, state: 'INCOMPLETE', code: 'PROJECTION_BINDING_MISMATCH',
        layout, declared: receipt.projection.sha256, actual,
      };
    }
  }
  return {
    ok: true,
    state: 'ACTIVE',
    code: 'OK',
    generationId: active.generationId,
    generationPath: active.generationPath,
    projectionPath: path.join(active.generationPath, PROJECTION_FILE),
    receiptPath: path.join(active.generationPath, RECEIPT_FILE),
    receipt,
    layout,
  };
}

// Report the fixed mirror against the active generation WITHOUT hashing the generation again
// when the caller already holds the active descriptor.
export function projectionMirrorStatus(projectionDb, projectionSha256) {
  const file = path.resolve(projectionDb);
  if (!existsSync(file)) return { path: file, state: 'ABSENT', sha256: null, inSync: false };
  const digest = sha256(readFileSync(file));
  return {
    path: file,
    state: digest === projectionSha256 ? 'IN_SYNC' : 'STALE_GENERATION',
    sha256: digest,
    inSync: digest === projectionSha256,
  };
}

export function recoverProjectionStore({ receiptDir, projectionDb = null, target = 'projection' }) {
  const recovered = recoverGenerationStore({ root: receiptDir, target });
  const active = readActiveProjectionGeneration({ receiptDir, verifyProjection: true });
  return {
    ...recovered,
    active,
    mirror: active.ok && projectionDb
      ? mirrorActiveProjectionGeneration({ receiptDir, projectionDb })
      : null,
  };
}

export function cleanupProjectionStore({ receiptDir }) {
  const removed = cleanupGenerationStore({ root: receiptDir });
  return { ...removed, pointerDebris: cleanupPointerDebris({ root: receiptDir }) };
}

export function inspectProjectionStore(receiptDir) {
  return {
    contract: PROJECTION_GENERATION_CONTRACT,
    storeContract: GENERATION_STORE_CONTRACT,
    store: inspectGenerationStore(receiptDir),
    active: readActiveProjectionGeneration({ receiptDir }),
  };
}

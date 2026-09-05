// XRA-KS-01 — exact closed shape validation for one PANSPHAIRA projection profile (v1).
// The profile arrives only as canonical JSON bytes over the local service boundary;
// no PANSPHAIRA module is imported and no dryRun bridge is used.

import { canonicalJson } from '../../../bi-control/src/canonical-json.js';

export const PROFILE_VERSION = 'pansphaira/projection-profile/v1';
export const PROFILE_FIELD_TYPES = Object.freeze([
  'BOOLEAN', 'DATE', 'DECIMAL', 'INT32', 'INT64', 'TEXT', 'TIMESTAMP',
]);
export const KNOWN_COLLAPSE_POLICIES = Object.freeze(['DROP', 'FILL_ZERO', 'IGNORE', 'ZERO_COLLAPSE']);
export const PROVENANCE_ORIGIN = 'PANSPHAIRA';
export const DEPENDENCY_ISSUE = 'https://github.com/JoFe2/PANSPHAIRA/issues/343';
export const MAX_PROFILE_BYTES = 16384;
export const TOP_LEVEL_KEYS = Object.freeze([
  'arithmeticUnit', 'fields', 'periodWindow', 'profileVersion', 'provenance', 'sourceRelation', 'unknownHandling',
]);
export const PERIOD_WINDOW_KEYS = Object.freeze(['end', 'start']);
export const PROVENANCE_KEYS = Object.freeze([
  'closedAt', 'dependencyIssue', 'origin', 'pansphairaHeadCommit', 'releaseReceiptSha256', 'status',
]);
export const HELD_NULLS = Object.freeze(['closedAt', 'pansphairaHeadCommit', 'releaseReceiptSha256']);
export const RELEASED_REQUIRED = Object.freeze(['closedAt', 'pansphairaHeadCommit', 'releaseReceiptSha256']);

const FIELD_NAME = /^[a-z][a-z0-9_]{1,62}$/;
const RELATION_NAME = /^[a-z][a-z0-9_]{2,62}$/;
const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;

export function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactKeys(value, allowed, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...allowed].sort())) fail(code);
}

function isIsoDate(value) {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2099) return false;
  const decoded = Date.UTC(year, month - 1, day);
  return new Date(decoded).getUTCFullYear() === year
    && new Date(decoded).getUTCMonth() === month - 1
    && new Date(decoded).getUTCDate() === day;
}

// Gate 1 (transport): bounded body, and the bytes must be exactly the canonical
// JSON form of the parsed document. Any drift is a canonicality denial.
export function parseCanonicalProfileBytes(rawBytes) {
  if (rawBytes.length === 0 || rawBytes.length > MAX_PROFILE_BYTES) fail('XRA_KS01_REQUEST_SIZE_DENIED');
  const text = Buffer.from(rawBytes).toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('XRA_KS01_PROFILE_CANONICALITY_DENIED');
  }
  if (canonicalJson(parsed) !== text) fail('XRA_KS01_PROFILE_CANONICALITY_DENIED');
  return parsed;
}

// Gate 3 (contract): exact closed v1 shape. Unknown-collapse policies are
// reported with their own semantic code before the generic contract denial.
export function validateProfileContract(profile) {
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
  exactKeys(profile, TOP_LEVEL_KEYS, 'XRA_KS01_PROFILE_CONTRACT_DENIED');
  if (profile.profileVersion !== PROFILE_VERSION) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
  if (!RELATION_NAME.test(profile.sourceRelation)) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
  if (!Array.isArray(profile.fields) || profile.fields.length < 1 || profile.fields.length > 32) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
  if (typeof profile.unknownHandling !== 'string') fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
  if (KNOWN_COLLAPSE_POLICIES.includes(profile.unknownHandling)) fail('XRA_KS01_UNKNOWN_COLLAPSE_DENIED');
  if (profile.unknownHandling !== 'SEPARATE_CHANNEL') fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
  if (profile.arithmeticUnit !== 'INTEGER_MINOR_UNITS') fail('XRA_KS01_PROFILE_CONTRACT_DENIED');

  const seen = new Set();
  for (const field of profile.fields) {
    const allowed = field && field.type === 'DECIMAL'
      ? ['name', 'nullable', 'precision', 'scale', 'type']
      : ['name', 'nullable', 'type'];
    exactKeys(field, allowed, 'XRA_KS01_PROFILE_CONTRACT_DENIED');
    if (typeof field.name !== 'string' || !FIELD_NAME.test(field.name)) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
    if (seen.has(field.name)) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
    seen.add(field.name);
    if (!PROFILE_FIELD_TYPES.includes(field.type)) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
    if (field.nullable !== true && field.nullable !== false) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
    if (field.type === 'DECIMAL') {
      if (!Number.isInteger(field.precision) || field.precision < 1 || field.precision > 38) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
      if (!Number.isInteger(field.scale) || field.scale < 0 || field.scale > 12) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
    }
  }

  exactKeys(profile.periodWindow, PERIOD_WINDOW_KEYS, 'XRA_KS01_PROFILE_CONTRACT_DENIED');
  if (!isIsoDate(profile.periodWindow.start) || !isIsoDate(profile.periodWindow.end)) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
  const [sy, sm, sd] = profile.periodWindow.start.split('-').map(Number);
  const [ey, em, ed] = profile.periodWindow.end.split('-').map(Number);
  const days = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000);
  if (days < 0 || days > 3659) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');

  exactKeys(profile.provenance, PROVENANCE_KEYS, 'XRA_KS01_PROFILE_CONTRACT_DENIED');
  if (profile.provenance.origin !== PROVENANCE_ORIGIN) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
  if (profile.provenance.dependencyIssue !== DEPENDENCY_ISSUE) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
  if (profile.provenance.status !== 'HELD' && profile.provenance.status !== 'RELEASED') fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
  for (const key of HELD_NULLS) {
    const value = profile.provenance[key];
    if (value !== null && !isEvidenceValue(key, value)) fail('XRA_KS01_PROFILE_CONTRACT_DENIED');
  }
  return profile;
}

function isEvidenceValue(key, value) {
  if (key === 'closedAt') return isIsoDate(value);
  if (key === 'releaseReceiptSha256') return typeof value === 'string' && HEX64.test(value);
  if (key === 'pansphairaHeadCommit') return typeof value === 'string' && HEX40.test(value);
  return false;
}
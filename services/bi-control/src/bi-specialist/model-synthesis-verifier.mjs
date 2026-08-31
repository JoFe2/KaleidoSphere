const REQUIRED_FIELDS = Object.freeze([
  'blind_spots',
  'confidence',
  'evidence_tables',
  'persistence_proposed',
  'summary',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isUniqueStringArray(value, { allowEmpty }) {
  return Array.isArray(value) && (allowEmpty || value.length > 0)
    && value.every((item) => typeof item === 'string' && item.length > 0)
    && new Set(value).size === value.length;
}

function sameSet(left, right) {
  return left.length === right.length && left.every((item) => new Set(right).has(item));
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function verifyModelSynthesis(observable, { evidenceTables, blindSpots }) {
  deepFreeze(observable);
  const reasonCodes = [];
  if (!isPlainObject(observable)) {
    reasonCodes.push('SCHEMA_OBJECT_REQUIRED');
  } else {
    const fields = Object.keys(observable).sort();
    if (fields.length !== REQUIRED_FIELDS.length || !fields.every((field, index) => field === REQUIRED_FIELDS[index])) {
      reasonCodes.push('SCHEMA_FIELDS_INVALID');
    }
    if (typeof observable.summary !== 'string' || observable.summary.trim().length === 0) {
      reasonCodes.push('SUMMARY_INVALID');
    } else {
      reasonCodes.push('SUMMARY_SEMANTICS_UNVERIFIED');
    }
    if (!isUniqueStringArray(observable.evidence_tables, { allowEmpty: false })) {
      reasonCodes.push('EVIDENCE_TABLES_INVALID');
    } else if (observable.evidence_tables.some((table) => !evidenceTables.includes(table))) {
      reasonCodes.push('EVIDENCE_TABLE_UNSUPPORTED');
    }
    if (typeof observable.confidence !== 'number' || !Number.isFinite(observable.confidence)
      || observable.confidence < 0 || observable.confidence > 1) {
      reasonCodes.push('CONFIDENCE_INVALID');
    }
    if (!isUniqueStringArray(observable.blind_spots, { allowEmpty: true })) {
      reasonCodes.push('BLIND_SPOTS_INVALID');
    } else if (!sameSet(observable.blind_spots, blindSpots)) {
      reasonCodes.push('BLIND_SPOTS_MISMATCH');
    }
    if (observable.persistence_proposed !== false) {
      reasonCodes.push('PERSISTENCE_PROPOSED_INVALID');
    }
  }
  return Object.freeze({
    status: reasonCodes.length === 0 ? 'bounded' : 'unbounded',
    reasonCodes: Object.freeze(reasonCodes),
  });
}

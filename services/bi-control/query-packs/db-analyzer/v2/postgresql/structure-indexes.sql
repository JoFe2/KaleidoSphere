SELECT
  namespace.nspname AS schema_name,
  relation.relname AS relation_name,
  index_relation.relname AS index_name,
  index_relation.oid AS index_oid,
  key_ordinal_range.key_ordinal AS key_ordinal,
  attribute.attname AS key_column_name,
  CASE
    WHEN attribute.attname IS NULL THEN 'EXPRESSION'
    ELSE 'COLUMN'
  END AS key_column_kind,
  type.typname AS data_type,
  index_row.indisunique AS is_unique,
  index_row.indisprimary AS is_primary,
  index_row.indisvalid AS is_valid,
  (index_row.indpred IS NOT NULL) AS has_predicate,
  CASE
    WHEN index_row.indpred IS NOT NULL THEN 'OMITTED_NO_RAW_PREDICATE'
    ELSE NULL
  END AS predicate_disclosure,
  'OMITTED_NO_RAW_DEFINITION' AS definition_disclosure
FROM pg_catalog.pg_index AS index_row
JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
JOIN pg_catalog.pg_class AS relation ON relation.oid = index_row.indrelid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
CROSS JOIN (VALUES (1), (2), (3), (4)) AS key_ordinal_range (key_ordinal)
LEFT JOIN pg_catalog.pg_attribute AS attribute
  ON attribute.attrelid = index_row.indrelid
  AND attribute.attnum = index_row.indkey[key_ordinal]
LEFT JOIN pg_catalog.pg_type AS type ON type.oid = attribute.atttypid
WHERE relation.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND key_ordinal_range.key_ordinal <= index_row.indnkeyatts
ORDER BY namespace.nspname, relation.relname, index_relation.relname, key_ordinal_range.key_ordinal;
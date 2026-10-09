// #317: exactly one fixed bounded stock query, not arbitrary SQL or a second BI engine.
// Parameters: tenant, granted/requested sites, valid-time cutoff, knowledge cutoff, business date.
export const OVERDUE_QUERY_VERSION = 'kaleidosphere.business-bi/overdue-stock-query/v1';
export const OVERDUE_QUERY_CTE = `WITH invoice_scope AS (
  SELECT tenant_id, record_id AS invoice_id, data,
    (data->>'amountMinorUnits')::bigint AS original_amount,
    (data->>'dueDate')::date AS due_date
  FROM synthetic_bi.overdue_invoices_v1
  WHERE tenant_id = $1 AND data->>'siteId' = ANY($2::text[])
    AND (data->>'validAt')::timestamptz <= $3::timestamptz
    AND (data->>'knownAt')::timestamptz <= $4::timestamptz
), payment_rollup AS (
  SELECT p.tenant_id, p.data->>'invoiceId' AS invoice_id,
    COALESCE(SUM((p.data->>'amountMinorUnits')::bigint), 0) AS paid,
    BOOL_OR(p.data->>'amountMinorUnits' IS NULL OR p.data->>'unit' IS NULL OR p.data->>'currency' IS NULL) AS unknown_payment,
    COUNT(*) AS payment_count
  FROM synthetic_bi.overdue_payments_v1 AS p
  WHERE p.tenant_id = $1
    AND (p.data->>'validAt')::timestamptz <= $3::timestamptz
    AND (p.data->>'knownAt')::timestamptz <= $4::timestamptz
  GROUP BY p.tenant_id, p.data->>'invoiceId'
), adjustment_rollup AS (
  SELECT a.tenant_id, a.data->>'invoiceId' AS invoice_id,
    COALESCE(SUM((a.data->>'amountMinorUnits')::bigint) FILTER (WHERE a.data->>'kind' = 'CREDIT'), 0) AS credited,
    BOOL_OR(a.data->>'kind' = 'CANCEL') AS cancelled,
    BOOL_OR(a.data->>'kind' = 'CREDIT' AND (a.data->>'amountMinorUnits' IS NULL OR a.data->>'unit' IS NULL OR a.data->>'currency' IS NULL)) AS unknown_credit,
    COUNT(*) AS adjustment_count
  FROM synthetic_bi.overdue_adjustments_v1 AS a
  WHERE a.tenant_id = $1
    AND (a.data->>'validAt')::timestamptz <= $3::timestamptz
    AND (a.data->>'knownAt')::timestamptz <= $4::timestamptz
  GROUP BY a.tenant_id, a.data->>'invoiceId'
), invoice_balance AS (
  SELECT i.tenant_id, i.invoice_id, i.data->>'siteId' AS site_id, i.due_date,
    COALESCE(a.cancelled, FALSE) AS cancelled,
    CASE WHEN COALESCE(a.cancelled, FALSE) THEN FALSE ELSE
      i.original_amount IS NULL OR i.data->>'unit' IS NULL OR i.data->>'currency' IS NULL
      OR COALESCE(p.unknown_payment, FALSE) OR COALESCE(a.unknown_credit, FALSE) END AS unknown_amount,
    CASE WHEN COALESCE(a.cancelled, FALSE) THEN 0 ELSE
      i.original_amount - COALESCE(p.paid, 0) - COALESCE(a.credited, 0) END AS balance,
    COALESCE(p.paid, 0)::text AS paid, COALESCE(a.credited, 0)::text AS credited,
    COALESCE(p.payment_count, 0)::integer AS payment_count,
    COALESCE(a.adjustment_count, 0)::integer AS adjustment_count
  FROM invoice_scope AS i
  LEFT JOIN payment_rollup AS p ON p.tenant_id = i.tenant_id AND p.invoice_id = i.invoice_id
  LEFT JOIN adjustment_rollup AS a ON a.tenant_id = i.tenant_id AND a.invoice_id = i.invoice_id
), classified AS (
  SELECT *, (NOT cancelled AND (unknown_amount OR (balance > 0 AND due_date IS NULL))) AS unknown_invoice,
    (NOT cancelled AND NOT unknown_amount AND balance > 0 AND due_date IS NOT NULL) AS known_open,
    (NOT cancelled AND NOT unknown_amount AND balance > 0 AND due_date < $5::date) AS known_overdue
  FROM invoice_balance
)`;
export const OVERDUE_SUMMARY_SQL = `${OVERDUE_QUERY_CTE}
SELECT COUNT(*)::integer AS scoped_invoice_count,
  COUNT(*) FILTER (WHERE unknown_invoice)::integer AS unknown_invoice_count,
  COUNT(*) FILTER (WHERE known_open)::integer AS known_open_count,
  COUNT(*) FILTER (WHERE known_overdue)::integer AS known_overdue_count,
  COALESCE(SUM(balance) FILTER (WHERE known_overdue), 0)::text AS known_overdue_minor_units,
  COALESCE(SUM(balance) FILTER (WHERE known_open), 0)::text AS known_open_minor_units,
  COUNT(*) FILTER (WHERE cancelled)::integer AS cancelled_invoice_count,
  COUNT(*) FILTER (WHERE NOT unknown_amount AND balance < 0)::integer AS credit_balance_invoice_count,
  COALESCE(SUM(-balance) FILTER (WHERE NOT unknown_amount AND balance < 0), 0)::text AS credit_balance_minor_units
FROM classified;`;
export const OVERDUE_DRILLDOWN_SQL = `${OVERDUE_QUERY_CTE}
SELECT invoice_id, site_id, due_date::text AS due_date, balance::text AS balance_minor_units,
  paid, credited, payment_count, adjustment_count
FROM classified WHERE known_overdue ORDER BY invoice_id, site_id LIMIT $6::integer;`;

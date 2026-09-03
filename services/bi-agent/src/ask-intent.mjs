// KS161 / ASK-INTENT
// Ask-intent extraction for the object-scoped catalog question route.
// The object extractor starts at the first trigger word, skips connector and
// keyword words, and fails closed to null when no object name remains.

export function technicalFamily(message) {
  if (/(größte|largest|size|capacity|bytes|block|verteilung)/i.test(message)) return 'largest_tables';
  if (/(row|zeilen|estimate|schätz|fresh|stale|statist)/i.test(message)) return 'row_estimates_freshness';
  if (/(inventory|inventar|valid|invalid|compile|schema|object|objekt)/i.test(message)) return 'object_inventory_validity';
  if (/(depend|abhäng|impact|uses|verwendet|nutzt|benutzt)/i.test(message)) return 'dependencies';
  if (/(signature|signatur|argument|stored|procedure|function|package|logic|code)/i.test(message)) return 'stored_logic_signatures';
  if (/(scheduler|job|materialized|mview|refresh|mv\b)/i.test(message)) return 'scheduler_mv_refresh';
  if (/(coverage|blind|denied|timeout|partial|caveat|abdeckung|lücke)/i.test(message)) return 'coverage_blind_spots';
  if (/(candidate|kandidat|bi[- ]?relev|dimension|measure|kennzahl)/i.test(message)) return 'bi_relevance_candidates';
  return null;
}

const OBJECT_TRIGGER =
  /\b(?:object|objekt|table|tabelle|uses|verwendet|nutzt|impact|dependencies|abhängigkeiten|signatures?|signaturen?)\b/i;
const OBJECT_SKIP_WORDS = new Set([
  'of', 'von', 'the', 'a', 'an', 'and', 'or', 'for', 'on', 'in', 'at', 'to',
  'der', 'die', 'das', 'den', 'dem', 'des', 'für', 'und', 'oder',
  'object', 'objekt', 'table', 'tabelle', 'schema', 'database',
  'uses', 'verwendet', 'nutzt', 'benutzt',
  'impact', 'dependencies', 'abhängigkeiten',
  'signature', 'signatures', 'signatur', 'signaturen',
  'function', 'funktion', 'procedure', 'verfahren', 'stored',
  'package', 'paket', 'view', 'ansicht', 'trigger',
]);
const OBJECT_TOKEN = /[\p{L}][\p{L}0-9_$#]*(?:\.[\p{L}][\p{L}0-9_$#]*)?/gu;

export function objectFromMessage(message) {
  const trigger = OBJECT_TRIGGER.exec(message);
  if (!trigger) return null;
  const rest = message.slice(trigger.index + trigger[0].length);
  for (const token of rest.matchAll(OBJECT_TOKEN)) {
    if (token[0].split('.').some((part) => OBJECT_SKIP_WORDS.has(part.toLowerCase()))) continue;
    return { name: token[0] };
  }
  return null;
}
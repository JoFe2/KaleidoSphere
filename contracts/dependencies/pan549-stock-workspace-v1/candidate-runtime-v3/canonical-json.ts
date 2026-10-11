export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("Canonical JSON accepts plain JSON objects only");
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => {
      if (record[key] === undefined) throw new TypeError("Canonical JSON rejects undefined object values");
      return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
    });
  return `{${entries.join(",")}}`;
}

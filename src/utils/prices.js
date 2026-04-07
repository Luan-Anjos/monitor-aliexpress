export function parseLoosePrice(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const raw = String(value).trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/\s+/g, " ")
    .replace(/[^\d,.-]/g, "")
    .replace(/,(?=\d{3}(\D|$))/g, "")
    .trim();

  if (!cleaned) return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let normalized = cleaned;

  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatPriceBRL(value) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function dedupeFinitePrices(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const parsed = parseLoosePrice(value);
    if (parsed === null || parsed <= 0) continue;

    const key = parsed.toFixed(2);
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(parsed);
  }

  return result.sort((a, b) => a - b);
}

export function chooseBestPrice(candidates) {
  const normalized = candidates
    .map((candidate) => ({
      ...candidate,
      price: parseLoosePrice(candidate.price),
    }))
    .filter((candidate) => candidate.price !== null && candidate.price > 0)
    .sort((a, b) => a.priority - b.priority || a.price - b.price);

  return normalized[0] || null;
}

export function parseBrazilianPrice(value) {
  if (value === null || value === undefined) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/\s+/g, "")
    .replace(/R\$/gi, "")
    .replace(/[^\d,.-]/g, "");

  if (!cleaned) return null;

  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function uniqueValidPrices(prices) {
  return [...new Set(prices.filter((value) => Number.isFinite(value) && value > 0))];
}

export function formatPrice(value) {
  if (!Number.isFinite(value)) return "não informado";

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

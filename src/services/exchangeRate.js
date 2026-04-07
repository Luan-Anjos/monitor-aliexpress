import axios from "axios";

// cache simples
const rateCache = new Map();

function buildCacheKey(base, quote) {
  const today = new Date().toISOString().slice(0, 10);
  return `${today}:${base}:${quote}`;
}

export async function getExchangeRate(baseCurrency, quoteCurrency) {
  const base = baseCurrency.toUpperCase();
  const quote = quoteCurrency.toUpperCase();

  if (base === quote) return 1;

  const cacheKey = buildCacheKey(base, quote);

  if (rateCache.has(cacheKey)) {
    return rateCache.get(cacheKey);
  }

  const response = await axios.get(
    `https://api.frankfurter.app/latest?from=${base}&to=${quote}`
  );

  const rate = response.data?.rates?.[quote];

  if (!rate) {
    throw new Error("Erro ao obter taxa de câmbio");
  }

  rateCache.set(cacheKey, rate);

  return rate;
}

export async function convertCurrency(amount, baseCurrency, quoteCurrency) {
  const value = Number(amount);

  if (!Number.isFinite(value)) return null;

  const rate = await getExchangeRate(baseCurrency, quoteCurrency);

  return Number((value * rate).toFixed(2));
}
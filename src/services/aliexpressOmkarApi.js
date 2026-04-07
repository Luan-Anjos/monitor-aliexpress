import axios from "axios";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { convertCurrency } from "./exchangeRate.js";

function extractProductId(url) {
  const patterns = [
    /item\/(\d+)\.html/i,
    /\/(\d+)\.html/i,
    /product_id=(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = String(url).match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

function parseLooseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  const normalized = raw
    .replace(/[^\d.,-]/g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSalePriceCandidates(payload) {
  const skuPricing = Array.isArray(payload?.sku_pricing) ? payload.sku_pricing : [];
  const candidates = [];

  for (const sku of skuPricing) {
    const salePrice = parseLooseNumber(sku?.sale_price);

    if (Number.isFinite(salePrice) && salePrice > 0) {
      candidates.push({
        skuId: sku?.sku_id || null,
        rawValue: salePrice,
        formatted: sku?.formatted_sale_price || null,
      });
      continue;
    }

    const formattedSalePrice = parseLooseNumber(sku?.formatted_sale_price);
    if (Number.isFinite(formattedSalePrice) && formattedSalePrice > 0) {
      candidates.push({
        skuId: sku?.sku_id || null,
        rawValue: formattedSalePrice,
        formatted: sku?.formatted_sale_price || null,
      });
    }
  }

  return candidates;
}

function pickLowestSalePrice(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return null;
  }

  return candidates.reduce((lowest, current) => {
    if (!lowest) return current;
    return current.rawValue < lowest.rawValue ? current : lowest;
  }, null);
}

export async function getPriceWithOmkarApi(product) {
  if (!config.useOmkarApi || !config.omkarApiKey) {
    return { found: false, source: "omkar" };
  }

  try {
    const productId = extractProductId(product.url);

    if (!productId) {
      logger.warn(`Não foi possível extrair product_id de ${product.url}`);
      return {
        found: false,
        source: "omkar",
      };
    }

    logger.info(`Consultando Omkar API para ${product.name} (product_id=${productId})`);

    const response = await axios.get(
      "https://aliexpress-scraper-api.omkar.cloud/aliexpress/product",
      {
        params: {
          product_id: productId,
        },
        headers: {
          "API-Key": config.omkarApiKey,
        },
        timeout: 20000,
      }
    );

    const payload = response.data || {};

    if (!payload?.id) {
      logger.warn(`Omkar API não retornou produto válido para ${product.name}`);
      return {
        found: false,
        source: "omkar",
        rawPayload: payload,
      };
    }

    const currency = String(payload?.currency || "USD").toUpperCase();
    const saleCandidates = getSalePriceCandidates(payload);

    if (!saleCandidates.length) {
      logger.warn(`Omkar API não retornou sale_price utilizável para ${product.name}`);
      return {
        found: false,
        source: "omkar",
        rawPayload: payload,
      };
    }

    const chosen = pickLowestSalePrice(saleCandidates);

    if (!chosen || !Number.isFinite(chosen.rawValue)) {
      logger.warn(`Não foi possível definir sale_price para ${product.name}`);
      return {
        found: false,
        source: "omkar",
        rawPayload: payload,
      };
    }

    let finalPrice = chosen.rawValue;

    if (currency !== "BRL") {
      finalPrice = await convertCurrency(chosen.rawValue, currency, "BRL");
    }

    if (!Number.isFinite(finalPrice)) {
      logger.warn(`Falha ao converter sale_price para BRL em ${product.name}`);
      return {
        found: false,
        source: "omkar",
        rawPayload: payload,
      };
    }

    logger.info(
      `Preço via Omkar API para ${product.name}: R$ ${finalPrice.toFixed(2)} (sku=${chosen.skuId}, sale_price=${chosen.rawValue} ${currency})`
    );

    return {
      found: true,
      source: "omkar",
      price: Number(finalPrice.toFixed(2)),
      currency,
      rawPrice: chosen.rawValue,
      itemId: payload?.id || null,
      itemTitle: payload?.title || null,
      skuId: chosen?.skuId || null,
      formattedSalePrice: chosen?.formatted || null,
      rawPayload: payload,
    };
  } catch (error) {
    const status = error?.response?.status;
    const data = error?.response?.data;

    logger.error(`Erro na Omkar API para ${product.name}`, {
      status,
      data,
      error: error.message,
    });

    return {
      found: false,
      source: "omkar",
      error: error.message,
      status,
      data,
    };
  }
}
import axios from "axios";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { parseBrazilianPrice } from "../utils/prices.js";

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

function collectCandidatePricesFromObject(input, bucket = []) {
  if (!input || typeof input !== "object") return bucket;

  if (Array.isArray(input)) {
    for (const item of input) {
      collectCandidatePricesFromObject(item, bucket);
    }
    return bucket;
  }

  const interestingKeys = [
    "target_sale_price",
    "sale_price",
    "price",
    "target_original_price",
    "original_price",
    "min_price",
    "max_price",
    "discount_price",
    "app_sale_price",
    "target_app_sale_price",
    "formatedPrice",
    "formatedActivityPrice",
    "sku_price",
  ];

  for (const [key, value] of Object.entries(input)) {
    if (interestingKeys.includes(key) && value !== null && value !== undefined) {
      bucket.push(value);
    }

    if (typeof value === "object") {
      collectCandidatePricesFromObject(value, bucket);
    }
  }

  return bucket;
}

export async function getPriceWithRapidAPI(product) {
  if (!config.useRapidApi || !config.rapidApiKey || !config.rapidApiHost) {
    return { found: false, source: "rapidapi" };
  }

  try {
    const productId = extractProductId(product.url);

    if (!productId) {
      logger.warn(`Não foi possível extrair o product_id de ${product.url}`);
      return { found: false, source: "rapidapi" };
    }

    logger.info(`Consultando RapidAPI para ${product.name} (product_id=${productId})`);

    const response = await axios.get(
      `https://${config.rapidApiHost}/api/v3/product-info`,
      {
        params: {
          product_id: productId,
          ship_to_country: config.targetCountry,
          target_currency: config.targetCurrency,
          target_language: config.targetLanguage,
        },
        headers: {
          "X-RapidAPI-Key": config.rapidApiKey,
          "X-RapidAPI-Host": config.rapidApiHost,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );

    const payload = response.data;
    const rawCandidates = collectCandidatePricesFromObject(payload, []);
    const parsedCandidates = rawCandidates
      .map((value) => parseBrazilianPrice(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);

    if (!parsedCandidates.length) {
      logger.warn(`RapidAPI não retornou preço utilizável para ${product.name}`);
      return {
        found: false,
        source: "rapidapi",
        rawPayload: payload,
      };
    }

    const price = parsedCandidates[0];

    logger.info(`Preço via RapidAPI para ${product.name}: R$ ${price.toFixed(2)}`);

    return {
      found: true,
      source: "rapidapi",
      price,
      candidates: parsedCandidates,
      rawPayload: payload,
    };
  } catch (error) {
    const status = error?.response?.status;
    const data = error?.response?.data;

    logger.error(`Erro na RapidAPI para ${product.name}`, {
      status,
      data,
      error: error.message,
    });

    return {
      found: false,
      source: "rapidapi",
      error: error.message,
      status,
      data,
    };
  }
}
import crypto from "node:crypto";
import axios from "axios";
import { extractAliExpressProductId } from "../utils/url.js";
import { formatShanghaiTimestamp } from "../utils/time.js";
import { parseLoosePrice } from "../utils/prices.js";

function sortObjectKeys(input) {
  return Object.keys(input)
    .sort()
    .reduce((acc, key) => {
      acc[key] = input[key];
      return acc;
    }, {});
}

function signPayload(payload, appSecret, signMethod = "md5") {
  const sorted = sortObjectKeys(payload);
  const concatenated = Object.entries(sorted).reduce(
    (acc, [key, value]) => `${acc}${key}${value}`,
    ""
  );

  const body = `${appSecret}${concatenated}${appSecret}`;

  if (signMethod === "hmac") {
    return crypto.createHmac("md5", appSecret).update(concatenated, "utf8").digest("hex").toUpperCase();
  }

  return crypto.createHash("md5").update(body, "utf8").digest("hex").toUpperCase();
}

function getProductListFromResponse(response) {
  const root = response?.aliexpress_affiliate_productdetail_get_response;
  const products = root?.resp_result?.result?.products?.product;
  if (Array.isArray(products)) return products;
  if (products && typeof products === "object") return [products];
  return [];
}

function mapAffiliateProduct(product) {
  const candidates = [
    product.target_sale_price,
    product.sale_price,
    product.target_app_sale_price,
    product.app_sale_price,
    product.target_original_price,
    product.original_price,
  ]
    .map(parseLoosePrice)
    .filter((value) => value !== null);

  const chosenPrice = candidates.length ? Math.min(...candidates) : null;

  return {
    source: "affiliate_api",
    productId: String(product.product_id || ""),
    productUrl: product.product_detail_url || "",
    title: product.product_title || "",
    price: chosenPrice,
    currency:
      product.target_sale_price_currency ||
      product.sale_price_currency ||
      product.target_app_sale_price_currency ||
      product.app_sale_price_currency ||
      product.target_original_price_currency ||
      product.original_price_currency ||
      null,
    raw: product,
  };
}

export function hasAffiliateApiCredentials(config) {
  return Boolean(config.aliExpress.appKey && config.aliExpress.appSecret);
}

export async function fetchAliExpressPriceViaAffiliateApi({ url, config, logger }) {
  if (!hasAffiliateApiCredentials(config)) {
    return null;
  }

  const productId = extractAliExpressProductId(url);
  if (!productId) {
    logger.warn(`Não foi possível extrair o productId da URL: ${url}`);
    return null;
  }

  const payload = {
    method: "aliexpress.affiliate.productdetail.get",
    app_key: config.aliExpress.appKey,
    sign_method: config.aliExpress.signMethod,
    timestamp: formatShanghaiTimestamp(),
    format: "json",
    v: "2.0",
    simplify: "false",
    product_ids: productId,
    target_currency: config.targetCurrency,
    target_language: config.targetLanguage,
    country: config.targetCountry,
  };

  if (config.aliExpress.trackingId) {
    payload.tracking_id = config.aliExpress.trackingId;
  }

  payload.sign = signPayload(payload, config.aliExpress.appSecret, config.aliExpress.signMethod);

  try {
    const response = await axios.post(config.aliExpress.gatewayUrl, new URLSearchParams(payload), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      timeout: config.requestTimeoutMs,
    });

    if (response.data?.error_response) {
      logger.warn("API afiliada retornou erro:", response.data.error_response);
      return null;
    }

    const products = getProductListFromResponse(response.data);
    if (!products.length) {
      logger.warn(`API afiliada não retornou produto para o ID ${productId}.`);
      return null;
    }

    const mapped = mapAffiliateProduct(products[0]);
    if (!mapped.price) {
      logger.warn(`API afiliada retornou produto sem preço utilizável para o ID ${productId}.`);
      return null;
    }

    return mapped;
  } catch (error) {
    logger.warn("Falha ao consultar a API afiliada:", error.response?.data || error.message);
    return null;
  }
}

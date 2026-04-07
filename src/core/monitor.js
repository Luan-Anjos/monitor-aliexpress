import { loadConfig } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { ensureDir } from "../utils/files.js";
import { parseLoosePrice, formatPriceBRL } from "../utils/prices.js";
import { randomBetween, sleep } from "../utils/time.js";
import { getSheetRows } from "../services/googleSheets.js";
import { sendDiscordReport } from "../services/discord.js";
import { fetchAliExpressPriceViaAffiliateApi, hasAffiliateApiCredentials } from "../services/aliexpressAffiliateApi.js";
import { createBrowserScraper } from "../services/aliexpressBrowser.js";

function buildProductFromRow(row, config) {
  return {
    name: row[config.columns.productName] || "Produto sem nome",
    sheetPriceRaw: row[config.columns.sheetPrice],
    url: row[config.columns.productUrl],
  };
}

function comparePrices(sheetPrice, currentPrice) {
  const diff = currentPrice - sheetPrice;
  const diffPercent = sheetPrice > 0 ? (diff / sheetPrice) * 100 : 0;

  if (Math.abs(diff) < 0.005) {
    return {
      kind: "same",
      diff,
      diffPercent,
      label: "⚪ preço igual",
    };
  }

  if (diff < 0) {
    return {
      kind: "down",
      diff,
      diffPercent,
      label: `🟢 caiu ${Math.abs(diffPercent).toFixed(2)}%`,
    };
  }

  return {
    kind: "up",
    diff,
    diffPercent,
    label: `🔴 subiu ${diffPercent.toFixed(2)}%`,
  };
}

function formatProductMessage(result) {
  if (!result.currentPrice) {
    return [
      `⚠️ **${result.productName}**`,
      `Preço planilha: ${formatPriceBRL(result.sheetPrice)}`,
      `Preço atual: não encontrado`,
      `Fonte tentada: ${result.providerLabel}`,
      `Link: ${result.productUrl}`,
    ].join("\n");
  }

  const comparison = comparePrices(result.sheetPrice, result.currentPrice);

  return [
    `🛒 **${result.productName}**`,
    `Preço planilha: ${formatPriceBRL(result.sheetPrice)}`,
    `Preço atual: ${formatPriceBRL(result.currentPrice)}`,
    `Status: ${comparison.label}`,
    `Fonte: ${result.providerLabel}`,
    `Link: ${result.productUrl}`,
  ].join("\n");
}

export async function runMonitor() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  if (config.debugArtifacts) {
    await ensureDir(config.debugDir);
  }

  logger.info("Lendo planilha...");
  const rows = await getSheetRows(config);

  if (!rows.length) {
    return {
      ok: true,
      statusCode: 200,
      body: { message: "Nenhum dado encontrado na planilha." },
    };
  }

  const products = rows
    .map((row) => buildProductFromRow(row, config))
    .filter((product) => product.url && product.sheetPriceRaw !== undefined && product.sheetPriceRaw !== null)
    .map((product) => ({
      ...product,
      sheetPrice: parseLoosePrice(product.sheetPriceRaw),
    }))
    .filter((product) => product.sheetPrice !== null && product.sheetPrice > 0);

  const limitedProducts = config.maxProductsPerRun > 0
    ? products.slice(0, config.maxProductsPerRun)
    : products;

  logger.info(`Produtos válidos para monitorar: ${limitedProducts.length}`);

  const browserScraper = await createBrowserScraper(config, logger);
  const useAffiliateApi = hasAffiliateApiCredentials(config);
  logger.info(`API afiliada ${useAffiliateApi ? "habilitada" : "não configurada"}.`);

  const results = [];

  try {
    for (let index = 0; index < limitedProducts.length; index += 1) {
      const product = limitedProducts[index];
      logger.info(`[${index + 1}/${limitedProducts.length}] Verificando ${product.name}`);

      let providerLabel = "browser";
      let current = null;

      if (useAffiliateApi) {
        const apiResult = await fetchAliExpressPriceViaAffiliateApi({
          url: product.url,
          config,
          logger,
        });

        if (apiResult?.price) {
          current = apiResult.price;
          providerLabel = "AliExpress Affiliate API";
        }
      }

      if (!current) {
        const browserResult = await browserScraper.fetchPrice(product.url, product.name);
        if (browserResult?.price) {
          current = browserResult.price;
          providerLabel = browserResult.selectedFrom
            ? `Browser (${browserResult.selectedFrom})`
            : "Browser";
        }
      }

      results.push({
        productName: product.name,
        productUrl: product.url,
        sheetPrice: product.sheetPrice,
        currentPrice: current,
        providerLabel,
      });

      const delay = randomBetween(config.delayMinMs, config.delayMaxMs);
      if (index < limitedProducts.length - 1) {
        logger.info(`Aguardando ${delay}ms antes do próximo produto...`);
        await sleep(delay);
      }
    }
  } finally {
    await browserScraper.close();
  }

  const changed = results.filter(
    (result) => result.currentPrice && comparePrices(result.sheetPrice, result.currentPrice).kind !== "same"
  );

  const visibleResults = config.onlyChanges ? changed : results;

  const header = [
    "🕵️‍♂️ Verificação do AliExpress",
    `Total analisado: ${results.length}`,
    `Alterações: ${changed.length}`,
    `Sem preço: ${results.filter((result) => !result.currentPrice).length}`,
  ].join("\n");

  const messageBody = visibleResults.length
    ? visibleResults.map(formatProductMessage).join("\n\n")
    : "Nenhuma alteração para reportar.";

  await sendDiscordReport(config.discordWebhookUrl, `${header}\n\n${messageBody}`, logger);

  return {
    ok: true,
    statusCode: 200,
    body: {
      message: `Finalizado. ${results.length} produto(s) analisado(s), ${changed.length} alteração(ões).`,
      analyzed: results.length,
      changed: changed.length,
      missingPrice: results.filter((result) => !result.currentPrice).length,
    },
  };
}

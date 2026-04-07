import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { formatPrice } from "../utils/prices.js";
import { randomDelay } from "../utils/time.js";
import { readProductsFromSheet } from "../services/googleSheets.js";
import { sendDiscordReport } from "../services/discord.js";
import { createBrowser, getPriceWithBrowser } from "../services/aliexpressBrowser.js";
import { getPriceWithRapidAPI } from "../services/aliexpressRapidApi.js";

function buildReport(results) {
  const total = results.length;
  const changed = results.filter((item) => item.changed).length;
  const withoutPrice = results.filter((item) => !item.currentPrice).length;

  const lines = [
    "🕵️ Verificação do AliExpress",
    `Total analisado: ${total}`,
    `Alterações: ${changed}`,
    `Sem preço: ${withoutPrice}`,
    "",
  ];

  for (const item of results) {
    const emoji = item.currentPrice ? (item.changed ? "📈" : "✅") : "⚠️";

    lines.push(`${emoji} **${item.name}**`);
    lines.push(`Preço planilha: ${formatPrice(item.sheetPrice)}`);
    lines.push(`Preço atual: ${item.currentPrice ? formatPrice(item.currentPrice) : "não encontrado"}`);
    lines.push(`Fonte usada: ${item.source || "desconhecida"}`);

    if (item.blocked) {
      lines.push("Observação: possível bloqueio/captcha detectado");
    }

    lines.push(`Link: ${item.url}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function runMonitor() {
  logger.info("Lendo planilha...");

  const products = await readProductsFromSheet();

  const limitedProducts =
    config.maxProductsPerRun > 0
      ? products.slice(0, config.maxProductsPerRun)
      : products;

  logger.info(`Produtos válidos para monitorar: ${limitedProducts.length}`);

  let browser = null;
  const results = [];

  try {
    browser = await createBrowser();

    if (!config.useRapidApi || !config.rapidApiKey) {
      logger.info("RapidAPI não configurada.");
    }

    for (let index = 0; index < limitedProducts.length; index += 1) {
      const product = limitedProducts[index];
      logger.info(`[${index + 1}/${limitedProducts.length}] Verificando ${product.name}`);

      let apiResult = await getPriceWithRapidAPI(product);
      let browserResult = null;

      if (!apiResult?.found) {
        browserResult = await getPriceWithBrowser(browser, product);
      }

      const finalResult = apiResult?.found ? apiResult : browserResult;

      const currentPrice = finalResult?.price || null;
      const changed =
        currentPrice !== null &&
        Number.isFinite(product.sheetPrice) &&
        currentPrice !== product.sheetPrice;

      results.push({
        name: product.name,
        url: product.url,
        sheetPrice: product.sheetPrice,
        currentPrice,
        changed,
        source: finalResult?.source || "nenhuma",
        blocked: Boolean(finalResult?.blocked),
      });

      if (index < limitedProducts.length - 1) {
        await randomDelay(config.delayMinMs, config.delayMaxMs);
      }
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const visibleResults = config.onlyChanges
    ? results.filter((item) => item.changed)
    : results;

  const report = buildReport(visibleResults);
  const discordResult = await sendDiscordReport(config.discordWebhookUrl, report);

  if (!discordResult?.ok && !discordResult?.skipped) {
    logger.warn("Monitor finalizado, mas o envio ao Discord falhou.");
  }

  return {
    ok: true,
    total: results.length,
    reportSent: Boolean(discordResult?.ok),
    results,
  };
}
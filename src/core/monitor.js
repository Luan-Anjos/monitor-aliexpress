import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { formatPrice } from "../utils/prices.js";
import { randomDelay } from "../utils/time.js";
import { readProductsFromSheet } from "../services/googleSheets.js";
import { sendDiscordReport } from "../services/discord.js";
import { createBrowser, getPriceWithBrowser } from "../services/aliexpressBrowser.js";
import { getPriceWithRapidAPI } from "../services/aliexpressRapidApi.js";

function calculateVariationPercent(oldPrice, newPrice) {
  if (!Number.isFinite(oldPrice) || !Number.isFinite(newPrice) || oldPrice <= 0) {
    return null;
  }

  const percent = ((newPrice - oldPrice) / oldPrice) * 100;
  return percent;
}

function getPriceStatus(sheetPrice, currentPrice) {
  if (!Number.isFinite(sheetPrice) || !Number.isFinite(currentPrice)) {
    return {
      emoji: "⚠️",
      label: "SEM COMPARAÇÃO",
      variationText: "não disponível",
      changed: false,
    };
  }

  const variation = calculateVariationPercent(sheetPrice, currentPrice);

  if (variation === null) {
    return {
      emoji: "⚠️",
      label: "SEM COMPARAÇÃO",
      variationText: "não disponível",
      changed: false,
    };
  }

  if (currentPrice > sheetPrice) {
    return {
      emoji: "🔺",
      label: "AUMENTOU",
      variationText: `+${variation.toFixed(2)}%`,
      changed: true,
    };
  }

  if (currentPrice < sheetPrice) {
    return {
      emoji: "🔻",
      label: "ABAIXOU",
      variationText: `${variation.toFixed(2)}%`,
      changed: true,
    };
  }

  return {
    emoji: "➖",
    label: "SEM ALTERAÇÃO",
    variationText: "0.00%",
    changed: false,
  };
}

function buildSummary(results) {
  const total = results.length;
  const increased = results.filter((item) => item.statusLabel === "AUMENTOU").length;
  const decreased = results.filter((item) => item.statusLabel === "ABAIXOU").length;
  const unchanged = results.filter((item) => item.statusLabel === "SEM ALTERAÇÃO").length;
  const withoutPrice = results.filter((item) => !item.currentPrice).length;

  return [
    "📊 **Relatório de Preço**",
    "",
    `📦 Total analisado: ${total}`,
    `🔺 Aumentaram: ${increased}`,
    `🔻 Abaixaram: ${decreased}`,
    `➖ Iguais: ${unchanged}`,
    `⚠️ Sem preço: ${withoutPrice}`,
    "",
  ];
}

function buildProductBlock(item) {
  if (!item.currentPrice) {
    return [
      `⚠️ **Produto: ${item.name}**`,
      "",
      "┌───────────────",
      `│ 💰 Anterior: ${formatPrice(item.sheetPrice)}`,
      "│ 💰 Atual:    não encontrado",
      "└───────────────",
      "",
      "📈 Variação: não disponível",
      `📌 Situação: SEM PREÇO`,
      `🧭 Fonte: ${item.source || "desconhecida"}`,
      `🔗 ${item.url}`,
      "",
    ];
  }

  return [
    `${item.statusEmoji} **Produto: ${item.name}**`,
    "",
    "┌───────────────",
    `│ 💰 Anterior: ${formatPrice(item.sheetPrice)}`,
    `│ 💰 Atual:    ${formatPrice(item.currentPrice)}`,
    "└───────────────",
    "",
    `📈 Variação: ${item.statusEmoji} ${item.variationText}`,
    `📌 Situação: ${item.statusLabel}`,
    `🧭 Fonte: ${item.source || "desconhecida"}`,
    `🔗 ${item.url}`,
    "",
  ];
}

function buildReport(results) {
  const lines = [...buildSummary(results)];

  for (const item of results) {
    lines.push(...buildProductBlock(item));
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
    if (config.useBrowserFallback) {
      browser = await createBrowser();
    } else {
      logger.info("Fallback de browser desativado.");
    }

    for (let index = 0; index < limitedProducts.length; index += 1) {
      const product = limitedProducts[index];
      logger.info(`[${index + 1}/${limitedProducts.length}] Verificando ${product.name}`);

      const apiResult = await getPriceWithRapidAPI(product);
      let browserResult = null;

      if (!apiResult?.found && config.useBrowserFallback && browser) {
        browserResult = await getPriceWithBrowser(browser, product);
      }

      const finalResult = apiResult?.found ? apiResult : browserResult;
      const currentPrice = finalResult?.price || null;

      const status = getPriceStatus(product.sheetPrice, currentPrice);

      results.push({
        name: product.name,
        url: product.url,
        sheetPrice: product.sheetPrice,
        currentPrice,
        changed: status.changed,
        source: finalResult?.source || (apiResult?.source || "nenhuma"),
        blocked: Boolean(finalResult?.blocked),
        apiError: apiResult?.error || apiResult?.data?.message || null,
        statusEmoji: status.emoji,
        statusLabel: status.label,
        variationText: status.variationText,
      });

      if (index < limitedProducts.length - 1) {
        await randomDelay(config.delayMinMs, config.delayMaxMs);
      }
    }
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        logger.warn("Browser já estava fechado.");
      }
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
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { ensureDir, saveTextFile } from "../utils/files.js";
import { parseBrazilianPrice, uniqueValidPrices } from "../utils/prices.js";

puppeteer.use(StealthPlugin());

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildLaunchArgs() {
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-features=site-per-process",
    "--window-size=1366,768",
  ];

  if (config.puppeteerProxyUrl) {
    args.push(`--proxy-server=${config.puppeteerProxyUrl}`);
  }

  return args;
}

export async function createBrowser() {
  const browser = await puppeteer.launch({
    headless: config.headless,
    executablePath: config.puppeteerExecutablePath || undefined,
    args: buildLaunchArgs(),
    defaultViewport: {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
    },
  });

  logger.info("Browser headless iniciado.");
  return browser;
}

async function preparePage(page) {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
  );

  await page.setExtraHTTPHeaders({
    "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  });

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
    });

    Object.defineProperty(navigator, "platform", {
      get: () => "Win32",
    });

    Object.defineProperty(navigator, "languages", {
      get: () => ["pt-BR", "pt", "en-US", "en"],
    });

    window.chrome = {
      runtime: {},
    };
  });
}

function detectPossibleBlock(url, title, html) {
  const lowerTitle = String(title || "").toLowerCase();
  const lowerUrl = String(url || "").toLowerCase();
  const lowerHtml = String(html || "").toLowerCase();

  const signals = [
    "captcha",
    "verify",
    "access denied",
    "punish",
    "bot",
    "security check",
    "unusual traffic",
    "are you a human",
  ];

  return signals.some(
    (signal) =>
      lowerTitle.includes(signal) ||
      lowerUrl.includes(signal) ||
      lowerHtml.includes(signal)
  );
}

async function extractPricesFromPage(page) {
  return await page.evaluate(() => {
    const texts = [];

    const selectors = [
      '[class*="price"]',
      '[class*="Price"]',
      '[data-pl="product-price"]',
      '[data-testid*="price"]',
      "meta[itemprop='price']",
      "span",
      "div",
    ];

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 300);
      for (const node of nodes) {
        if (node.tagName?.toLowerCase() === "meta") {
          const content = node.getAttribute("content");
          if (content) texts.push(content);
          continue;
        }

        const text = node.textContent?.trim();
        if (text && text.length <= 80) {
          texts.push(text);
        }
      }
    }

    const jsonCandidates = [];

    const possibleObjects = [
      window.__INIT_DATA__,
      window.runParams,
      window.__data__,
      window.__NEXT_DATA__,
    ];

    for (const item of possibleObjects) {
      if (item) {
        try {
          jsonCandidates.push(JSON.stringify(item));
        } catch { }
      }
    }

    const scriptTexts = Array.from(document.scripts)
      .map((script) => script.textContent || "")
      .filter(Boolean)
      .slice(0, 100);

    return {
      title: document.title || "",
      html: document.documentElement.outerHTML || "",
      visibleTexts: texts,
      scriptTexts,
      jsonCandidates,
      finalUrl: location.href,
    };
  });
}

function collectPricesFromTexts(texts = []) {
  const prices = [];

  for (const text of texts) {
    const matches = String(text).match(/(?:R\$\s?)?\d{1,3}(?:\.\d{3})*,\d{2}/g) || [];
    for (const match of matches) {
      const value = parseBrazilianPrice(match);
      if (value) prices.push(value);
    }
  }

  return uniqueValidPrices(prices);
}

function collectStructuredPrices(rawPayload) {
  const allTexts = [
    ...(rawPayload.jsonCandidates || []),
    ...(rawPayload.scriptTexts || []),
  ];

  const prices = [];

  const pricePatterns = [
    /"target_sale_price"\s*:\s*"([^"]+)"/gi,
    /"target_app_sale_price"\s*:\s*"([^"]+)"/gi,
    /"sale_price"\s*:\s*"([^"]+)"/gi,
    /"min_price"\s*:\s*"([^"]+)"/gi,
    /"activity_amount"\s*:\s*"([^"]+)"/gi,
    /"formatedActivityPrice"\s*:\s*"([^"]+)"/gi,
    /"formatedPrice"\s*:\s*"([^"]+)"/gi,
    /"price"\s*:\s*"([^"]+)"/gi,
  ];

  for (const text of allTexts) {
    for (const pattern of pricePatterns) {
      for (const match of text.matchAll(pattern)) {
        const raw = match[1];
        const parsed = parseBrazilianPrice(raw);
        if (parsed) prices.push(parsed);
      }
    }
  }

  return uniqueValidPrices(prices);
}

async function saveDebugFiles(productName, payload) {
  if (!config.debugArtifacts) return;

  await ensureDir(config.debugDir);

  const safeName = productName.replace(/[^\w\d-_]+/g, "_");
  const htmlPath = `${config.debugDir}/${safeName}.html`;
  const txtPath = `${config.debugDir}/${safeName}.txt`;

  await saveTextFile(htmlPath, payload.html || "");
  await saveTextFile(
    txtPath,
    [
      `TITLE: ${payload.title || ""}`,
      `URL: ${payload.finalUrl || ""}`,
      "",
      "VISIBLE TEXTS:",
      ...(payload.visibleTexts || []),
    ].join("\n")
  );
}

export async function getPriceWithBrowser(browser, product) {
  const page = await browser.newPage();

  try {
    await preparePage(page);

    logger.info(`Abrindo produto no navegador: ${product.name}`);

    await page.goto(product.url, {
      waitUntil: "domcontentloaded",
      timeout: config.requestTimeoutMs,
    });

    await sleep(10000);

    try {
      await page.waitForSelector('[class*="price"], [class*="Price"], meta[itemprop="price"]', {
        timeout: config.waitForSelectorTimeoutMs,
      });
    } catch {
      logger.warn(`Timeout esperando preço renderizar para ${product.name}.`);
    }

    await sleep(5000);

    const payload = await extractPricesFromPage(page);
    await saveDebugFiles(product.name, payload);

    const blocked = detectPossibleBlock(payload.finalUrl, payload.title, payload.html);
    if (blocked) {
      logger.warn(`Possível bloqueio detectado para ${product.name}.`);
      return {
        found: false,
        source: "browser",
        blocked: true,
        price: null,
      };
    }

    const structuredPrices = collectStructuredPrices(payload);
    const visiblePrices = collectPricesFromTexts(payload.visibleTexts);

    const candidates = uniqueValidPrices([
      ...structuredPrices,
      ...visiblePrices,
    ]).sort((a, b) => a - b);

    if (!candidates.length) {
      logger.warn(`Nenhum preço encontrado no browser para ${product.name}.`);
      return {
        found: false,
        source: "browser",
        blocked: false,
        price: null,
      };
    }

    const selectedPrice = candidates[0];

    logger.info(`Preço encontrado no browser para ${product.name}: R$ ${selectedPrice.toFixed(2)}`);

    return {
      found: true,
      source: "browser",
      blocked: false,
      price: selectedPrice,
      candidates,
    };
  } catch (error) {
    logger.error(`Erro no browser para ${product.name}: ${error.message}`);
    return {
      found: false,
      source: "browser",
      blocked: false,
      price: null,
      error: error.message,
    };
  } finally {
    await page.close();
  }
}
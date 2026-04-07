import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { chooseBestPrice, dedupeFinitePrices } from "../utils/prices.js";
import { randomBetween, sleep } from "../utils/time.js";
import { saveDebugArtifacts } from "../utils/files.js";

puppeteer.use(StealthPlugin());

function buildLaunchOptions(config) {
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--lang=pt-BR,pt,en-US,en",
  ];

  if (config.puppeteerProxyUrl) {
    args.push(`--proxy-server=${config.puppeteerProxyUrl}`);
  }

  const launchOptions = {
    headless: config.headless,
    args,
  };

  if (config.puppeteerExecutablePath) {
    launchOptions.executablePath = config.puppeteerExecutablePath;
  }

  return launchOptions;
}

async function preparePage(page, config) {
  await page.setCacheEnabled(false);
  await page.setDefaultNavigationTimeout(config.requestTimeoutMs);
  await page.setDefaultTimeout(config.requestTimeoutMs);

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
  );

  await page.setExtraHTTPHeaders({
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  });

  await page.setViewport({
    width: 1366,
    height: 900,
    deviceScaleFactor: 1,
  });

  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const type = request.resourceType();
    if (["image", "font", "media"].includes(type)) {
      request.abort();
      return;
    }
    request.continue();
  });
}

async function extractCandidates(page) {
  return page.evaluate(() => {
    function getByPath(obj, path) {
      return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
    }

    const structuredCandidates = [];
    const textCandidates = [];

    const structuredPaths = [
      ["runParams", "data", "priceModule", "minActivityAmount", "value"],
      ["runParams", "data", "priceModule", "minAmount", "value"],
      ["runParams", "data", "priceModule", "formatedActivityPrice"],
      ["runParams", "data", "priceModule", "formatedPrice"],
      ["runParams", "data", "priceModule", "priceDisplay"],
      ["runParams", "data", "root", "fields", "priceModule", "minActivityAmount", "value"],
      ["runParams", "data", "root", "fields", "priceModule", "minAmount", "value"],
      ["runParams", "data", "root", "fields", "priceModule", "formatedActivityPrice"],
      ["runParams", "data", "root", "fields", "priceModule", "formatedPrice"],
      ["__INIT_DATA__", "data", "priceModule", "minActivityAmount", "value"],
      ["__INIT_DATA__", "data", "priceModule", "minAmount", "value"],
      ["__INIT_DATA__", "data", "root", "fields", "priceModule", "minActivityAmount", "value"],
      ["__INIT_DATA__", "data", "root", "fields", "priceModule", "minAmount", "value"],
    ];

    const globals = {
      runParams: window.runParams,
      __INIT_DATA__: window.__INIT_DATA__,
    };

    for (const path of structuredPaths) {
      const [root, ...rest] = path;
      const value = getByPath(globals[root], rest);
      if (value !== undefined && value !== null && value !== "") {
        structuredCandidates.push({
          source: `global.${path.join(".")}`,
          value: String(value),
        });
      }
    }

    const selectors = [
      "span.product-price-value",
      "[class*='price--currentPriceText']",
      "[class*='price-default--current']",
      "[class*='price-current']",
      "[class*='uniform-banner-box-price']",
      "[class*='product-price']",
      "meta[property='og:title']",
    ];

    const seenTexts = new Set();

    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        const text = selector.startsWith("meta")
          ? node.getAttribute("content")
          : node.textContent;

        const normalized = String(text || "").replace(/\s+/g, " ").trim();
        if (!normalized || normalized.length > 160 || seenTexts.has(normalized)) continue;
        if (!/[\d]/.test(normalized)) continue;
        seenTexts.add(normalized);
        textCandidates.push({ source: `dom.${selector}`, value: normalized });
      }
    }

    return {
      title: document.title || null,
      finalUrl: location.href,
      structuredCandidates,
      textCandidates,
    };
  });
}

function chooseBrowserPrice(extraction) {
  const prioritized = [
    ...extraction.structuredCandidates.map((candidate, index) => ({
      price: candidate.value,
      source: candidate.source,
      priority: 10 + index,
    })),
    ...extraction.textCandidates.map((candidate, index) => ({
      price: candidate.value,
      source: candidate.source,
      priority: 100 + index,
    })),
  ];

  return chooseBestPrice(prioritized);
}

function detectBlock({ title, finalUrl, textCandidates }) {
  if (/captcha|verify|blocked|interception|punish/i.test(title || "")) return true;
  if (/\/punish\?|captcha|verify/i.test(finalUrl || "")) return true;
  if (!textCandidates.length && /signin|login|error/i.test(title || "")) return true;
  return false;
}

export async function createBrowserScraper(config, logger) {
  const browser = await puppeteer.launch(buildLaunchOptions(config));
  logger.info("Browser headless iniciado.");

  return {
    async fetchPrice(url, productName) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();

      try {
        await preparePage(page, config);

        logger.info(`Abrindo produto no navegador: ${productName}`);
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: config.requestTimeoutMs,
        });

        await sleep(randomBetween(1500, 3200));

        try {
          await page.waitForFunction(
            () => {
              const hasStructuredData = Boolean(
                window.runParams?.data?.priceModule ||
                  window.runParams?.data?.root?.fields?.priceModule ||
                  window.__INIT_DATA__?.data?.priceModule ||
                  window.__INIT_DATA__?.data?.root?.fields?.priceModule
              );

              const hasDomPrice = Boolean(
                document.querySelector("span.product-price-value") ||
                  document.querySelector("[class*='price--currentPriceText']") ||
                  document.querySelector("[class*='price-default--current']") ||
                  document.querySelector("[class*='price-current']")
              );

              return hasStructuredData || hasDomPrice;
            },
            { timeout: config.waitForSelectorTimeoutMs }
          );
        } catch {
          logger.warn(`Timeout esperando preço renderizar para ${productName}.`);
        }

        const extraction = await extractCandidates(page);

        if (detectBlock(extraction)) {
          logger.warn(`Possível bloqueio detectado para ${productName}.`);
          if (config.debugArtifacts) {
            await saveDebugArtifacts({
              page,
              productName,
              suffix: "blocked",
              debugDir: config.debugDir,
            });
          }
          return {
            source: "browser",
            blocked: true,
            productUrl: extraction.finalUrl,
            title: extraction.title,
            price: null,
          };
        }

        const selected = chooseBrowserPrice(extraction);
        const structuredPrices = dedupeFinitePrices(extraction.structuredCandidates.map((item) => item.value));
        const domPrices = dedupeFinitePrices(extraction.textCandidates.map((item) => item.value));

        if (!selected) {
          logger.warn(`Nenhum preço confiável encontrado no navegador para ${productName}.`);
          if (config.debugArtifacts) {
            await saveDebugArtifacts({
              page,
              productName,
              suffix: "noprice",
              debugDir: config.debugDir,
            });
          }
          return {
            source: "browser",
            blocked: false,
            productUrl: extraction.finalUrl,
            title: extraction.title,
            price: null,
            debug: { structuredPrices, domPrices },
          };
        }

        if (config.debugArtifacts) {
          await saveDebugArtifacts({
            page,
            productName,
            suffix: "ok",
            debugDir: config.debugDir,
          });
        }

        return {
          source: "browser",
          blocked: false,
          productUrl: extraction.finalUrl,
          title: extraction.title,
          price: selected.price,
          selectedFrom: selected.source,
          debug: { structuredPrices, domPrices },
        };
      } catch (error) {
        logger.error(`Erro no browser para ${productName}:`, error.message);
        if (config.debugArtifacts) {
          try {
            await saveDebugArtifacts({
              page,
              productName,
              suffix: "error",
              debugDir: config.debugDir,
            });
          } catch {}
        }

        return {
          source: "browser",
          blocked: false,
          productUrl: url,
          title: null,
          price: null,
          error: error.message,
        };
      } finally {
        try {
          await page.close();
        } catch {}
        try {
          await context.close();
        } catch {}
      }
    },

    async close() {
      await browser.close();
    },
  };
}

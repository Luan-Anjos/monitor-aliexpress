import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return ["1", "true", "yes", "y", "on"].includes(String(value).toLowerCase());
}

function parseInteger(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseJsonEnv(name, { required = false } = {}) {
  const raw = process.env[name];

  if (!raw) {
    if (required) {
      throw new Error(`A variável ${name} não foi definida.`);
    }
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`A variável ${name} não contém um JSON válido: ${error.message}`);
  }
}

export function loadConfig() {
  const config = {
    spreadsheetId: process.env.SPREADSHEET_ID || "",
    googleServiceAccount: parseJsonEnv("GOOGLE_SERVICE_ACCOUNT", { required: true }),
    googleSheetRange: process.env.GOOGLE_SHEET_RANGE || "A2:H",
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || "",

    columns: {
      productName: parseInteger(process.env.COLUMN_PRODUCT_NAME, 0),
      sheetPrice: parseInteger(process.env.COLUMN_SHEET_PRICE, 2),
      productUrl: parseInteger(process.env.COLUMN_PRODUCT_URL, 7),
    },

    maxProductsPerRun: parseInteger(process.env.MAX_PRODUCTS_PER_RUN, 0),
    onlyChanges: parseBoolean(process.env.ONLY_CHANGES, false),

    headless: parseBoolean(process.env.HEADLESS, true),
    logLevel: process.env.LOG_LEVEL || "info",
    debugArtifacts: parseBoolean(process.env.DEBUG_ARTIFACTS, true),
    debugDir: path.resolve(process.env.DEBUG_DIR || "./debug"),

    delayMinMs: parseInteger(process.env.DELAY_MIN_MS, 7000),
    delayMaxMs: parseInteger(process.env.DELAY_MAX_MS, 15000),
    requestTimeoutMs: parseInteger(process.env.REQUEST_TIMEOUT_MS, 60000),
    waitForSelectorTimeoutMs: parseInteger(
      process.env.WAIT_FOR_SELECTOR_TIMEOUT_MS,
      25000
    ),

    targetCountry: process.env.TARGET_COUNTRY || "BR",
    targetCurrency: process.env.TARGET_CURRENCY || "BRL",
    targetLanguage: process.env.TARGET_LANGUAGE || "PT",

    puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "",
    puppeteerProxyUrl: process.env.PUPPETEER_PROXY_URL || "",

    aliExpress: {
      appKey: process.env.AE_APP_KEY || "",
      appSecret: process.env.AE_APP_SECRET || "",
      trackingId: process.env.AE_TRACKING_ID || "",
      gatewayUrl: process.env.AE_GATEWAY_URL || "https://eco.taobao.com/router/rest",
      signMethod: (process.env.AE_SIGN_METHOD || "md5").toLowerCase(),
    },
  };

  if (!config.spreadsheetId) {
    throw new Error("A variável SPREADSHEET_ID é obrigatória.");
  }

  if (config.delayMaxMs < config.delayMinMs) {
    throw new Error("DELAY_MAX_MS não pode ser menor que DELAY_MIN_MS.");
  }

  return config;
}

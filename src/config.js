import dotenv from "dotenv";

dotenv.config();

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return String(value).toLowerCase() === "true";
}

function parseNumber(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseJsonEnv(name, required = false) {
  const value = process.env[name];

  if (!value) {
    if (required) {
      throw new Error(`Variável obrigatória ausente: ${name}`);
    }
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Variável ${name} contém JSON inválido.`);
  }
}

export const config = {
  spreadsheetId: process.env.SPREADSHEET_ID || "",
  googleServiceAccount: parseJsonEnv("GOOGLE_SERVICE_ACCOUNT", true),

  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || "",

  googleSheetRange: process.env.GOOGLE_SHEET_RANGE || "A2:H",
  columnProductName: parseNumber(process.env.COLUMN_PRODUCT_NAME, 0),
  columnSheetPrice: parseNumber(process.env.COLUMN_SHEET_PRICE, 2),
  columnProductUrl: parseNumber(process.env.COLUMN_PRODUCT_URL, 7),

  maxProductsPerRun: parseNumber(process.env.MAX_PRODUCTS_PER_RUN, 0),
  onlyChanges: parseBoolean(process.env.ONLY_CHANGES, false),

  headless: parseBoolean(process.env.HEADLESS, true),
  logLevel: process.env.LOG_LEVEL || "info",

  debugArtifacts: parseBoolean(process.env.DEBUG_ARTIFACTS, true),
  debugDir: process.env.DEBUG_DIR || "./debug",

  delayMinMs: parseNumber(process.env.DELAY_MIN_MS, 12000),
  delayMaxMs: parseNumber(process.env.DELAY_MAX_MS, 22000),
  requestTimeoutMs: parseNumber(process.env.REQUEST_TIMEOUT_MS, 60000),
  waitForSelectorTimeoutMs: parseNumber(process.env.WAIT_FOR_SELECTOR_TIMEOUT_MS, 35000),

  targetCountry: process.env.TARGET_COUNTRY || "BR",
  targetCurrency: process.env.TARGET_CURRENCY || "BRL",
  targetLanguage: process.env.TARGET_LANGUAGE || "PT",

  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "",
  puppeteerProxyUrl: process.env.PUPPETEER_PROXY_URL || "",

  aeAppKey: process.env.AE_APP_KEY || "",
  aeAppSecret: process.env.AE_APP_SECRET || "",
  aeTrackingId: process.env.AE_TRACKING_ID || "",
  aeGatewayUrl: process.env.AE_GATEWAY_URL || "https://eco.taobao.com/router/rest",
  aeSignMethod: process.env.AE_SIGN_METHOD || "md5",
};

if (!config.spreadsheetId) {
  throw new Error("Variável obrigatória ausente: SPREADSHEET_ID");
}

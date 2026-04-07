import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return String(value).toLowerCase() === "true";
}

function parseNumber(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseServiceAccount() {
  const jsonFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  const jsonInline = process.env.GOOGLE_SERVICE_ACCOUNT;

  if (jsonFile) {
    const raw = fs.readFileSync(jsonFile, "utf8");
    return JSON.parse(raw);
  }

  if (jsonInline) {
    return JSON.parse(jsonInline);
  }

  throw new Error(
    "Informe GOOGLE_SERVICE_ACCOUNT_FILE ou GOOGLE_SERVICE_ACCOUNT no .env"
  );
}

export const config = {
  spreadsheetId: process.env.SPREADSHEET_ID || "",
  googleServiceAccount: parseServiceAccount(),

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

  useRapidApi: parseBoolean(process.env.USE_RAPIDAPI, false),
  rapidApiKey: process.env.RAPIDAPI_KEY || "",
  rapidApiHost: process.env.RAPIDAPI_HOST || "aliexpress-true-api.p.rapidapi.com",
};

if (!config.spreadsheetId) {
  throw new Error("Variável obrigatória ausente: SPREADSHEET_ID");
}
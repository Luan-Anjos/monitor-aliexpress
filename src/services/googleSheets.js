import { google } from "googleapis";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { parseBrazilianPrice } from "../utils/prices.js";

function normalizeRow(row) {
  const name = String(row?.[config.columnProductName] || "").trim();
  const url = String(row?.[config.columnProductUrl] || "").trim();
  const rawSheetPrice = row?.[config.columnSheetPrice] ?? "";

  const sheetPrice = parseBrazilianPrice(rawSheetPrice);

  if (!name || !url || !sheetPrice) {
    return null;
  }

  return {
    name,
    url,
    sheetPrice,
  };
}

export async function readProductsFromSheet() {
  const auth = new google.auth.GoogleAuth({
    credentials: config.googleServiceAccount,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const client = await auth.getClient();

  const sheets = google.sheets({
    version: "v4",
    auth: client,
  });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: config.googleSheetRange,
  });

  const rows = response.data.values || [];

  const products = rows
    .map(normalizeRow)
    .filter(Boolean);

  logger.info(`Produtos válidos para monitorar: ${products.length}`);

  return products;
}
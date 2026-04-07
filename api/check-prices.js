import dotenv from "dotenv";
dotenv.config();

import { google } from "googleapis";
import axios from "axios";

// 🔥 Puppeteer + Stealth
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GOOGLE_SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

// ================= GOOGLE SHEETS =================
async function getSheetData() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `A2:H`,
  });

  return res.data.values;
}

// ================= PEGAR PREÇO =================
async function fetchPriceAliExpress(page, url) {
  try {
    await page.setViewport({ width: 1366, height: 768 });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // espera JS carregar
    await new Promise((r) => setTimeout(r, 7000));

    const price = await page.evaluate(() => {
      // 🔥 MÉTODO PRINCIPAL (JS interno do AliExpress)
      try {
        const data = window.runParams || window.__INIT_DATA__;

        if (data) {
          const priceModule =
            data?.data?.priceModule ||
            data?.data?.root?.fields?.priceModule;

          if (priceModule) {
            return (
              priceModule.formatedActivityPrice ||
              priceModule.formatedPrice ||
              priceModule.minActivityAmount?.value ||
              priceModule.minAmount?.value
            );
          }
        }
      } catch (e) {}

      // 🔥 FALLBACK HTML
      const selectors = [
        '[class*="price--currentPriceText"]',
        '[class*="price-default--current"]',
        '[class*="uniform-banner-box-price"]',
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.includes("R$")) {
          return el.innerText;
        }
      }

      return null;
    });

    if (!price) {
      console.warn(`❌ Preço não encontrado: ${url}`);
      return null;
    }

    const parsed = parseFloat(
      price
        .toString()
        .replace(/\s/g, "")
        .replace(/[^\d,\.]/g, "")
        .replace(",", ".")
    );

    return isNaN(parsed) ? null : parsed;

  } catch (error) {
    console.error(`Erro ao buscar preço (${url}):`, error.message);
    return null;
  }
}

// ================= DISCORD =================
async function sendDiscordMessage(message) {
  try {
    await axios.post(DISCORD_WEBHOOK_URL, { content: message });
  } catch (error) {
    console.error("Erro ao enviar mensagem no Discord:", error.message);
  }
}

// ================= HANDLER =================
export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    return res.status(405).send("Método não permitido");
  }

  const rows = await getSheetData();

  if (!rows || rows.length === 0) {
    return res.status(200).send("Nenhum dado encontrado na planilha.");
  }

  let reportMessages = [];
  let changesCount = 0;

  // 🔥 Browser stealth
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  );

  await page.setExtraHTTPHeaders({
    "Accept-Language": "pt-BR,pt;q=0.9",
  });

  for (const row of rows) {
    const productName = row[0];
    const storePriceText = row[2];
    const productLink = row[7];

    if (!productLink || !storePriceText) continue;

    const storePrice = parseFloat(
      storePriceText.replace(/[^\d,\.]/g, "").replace(",", ".")
    );

    if (isNaN(storePrice)) continue;

    console.log(`🔎 Verificando: ${productName}`);

    const currentPrice = await fetchPriceAliExpress(page, productLink);

    if (currentPrice === null) {
      reportMessages.push(`⚠️ Não foi possível obter o preço de **${productName}**`);
      continue;
    }

    const diff = currentPrice - storePrice;
    const diffPercent = ((diff / storePrice) * 100).toFixed(2);

    let status = "⚪ preço igual";

    if (diff < 0) {
      status = `🟢 preço caiu ${Math.abs(diffPercent)}%`;
      changesCount++;
    } else if (diff > 0) {
      status = `🔴 preço subiu ${diffPercent}%`;
      changesCount++;
    }

    reportMessages.push(
      `🛒 **${productName}**
Preço da planilha: R$ ${storePrice.toFixed(2)}
Preço atual: R$ ${currentPrice.toFixed(2)}
Status: ${status}
Link: ${productLink}`
    );
  }

  await browser.close();

  const headerMessage = `🕵️‍♂️ Verificação de preços do AliExpress - Resultado: ${changesCount} produto(s) com alteração`;

  await sendDiscordMessage(`${headerMessage}\n\n${reportMessages.join("\n\n")}`);

  return res.status(200).json({
    message: `Verificação concluída. ${changesCount} produto(s) com alteração.`,
  });
}

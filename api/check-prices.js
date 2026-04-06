import dotenv from "dotenv";
dotenv.config();

import { google } from "googleapis";
import axios from "axios";
import puppeteer from "puppeteer";

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

// ================= PUPPETEER =================
async function fetchPriceAliExpress(page, url) {
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Espera seletor mais confiável
    await page.waitForSelector("body", { timeout: 15000 });

    // Aguarda um pouco para render JS
    await new Promise((r) => setTimeout(r, 5000));

    let priceText = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      priceText = await page.evaluate(() => {
        const selectors = [
          '[class*="price--currentPriceText"]',
          '[class*="price-default--current"]',
          '[class*="uniform-banner-box-price"]',
          '[class*="price-current"]',
        ];

        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el && el.innerText.includes("R$")) {
            return el.innerText;
          }
        }

        return null;
      });

      if (priceText) break;

      // tenta recarregar se falhar
      await new Promise((r) => setTimeout(r, 3000));
      await page.reload({ waitUntil: "networkidle2" });
    }

    // DEBUG (print da tela)
    if (!priceText) {
      await page.screenshot({
        path: `debug-${Date.now()}.png`,
        fullPage: true,
      });
      console.warn(`❌ Preço não encontrado: ${url}`);
      return null;
    }

    const price = parseFloat(
      priceText
        .replace(/\s/g, "")
        .replace(/[^\d,\.]/g, "")
        .replace(",", ".")
    );

    return isNaN(price) ? null : price;
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
  if (req.method !== "GET") {
    return res.status(405).send("Método não permitido");
  }

  const rows = await getSheetData();

  if (!rows || rows.length === 0) {
    return res.status(200).send("Nenhum dado encontrado na planilha.");
  }

  let reportMessages = [];
  let changesCount = 0;

  // 🔥 abre browser UMA vez só
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  // simula navegador real
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  );

  await page.setExtraHTTPHeaders({
    "Accept-Language": "pt-BR,pt;q=0.9",
  });

  await page.emulateTimezone("America/Sao_Paulo");

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

    let status = "";
    const diff = currentPrice - storePrice;
    const diffPercent = ((diff / storePrice) * 100).toFixed(2);

    if (diff === 0) {
      status = "⚪ preço igual";
    } else if (diff < 0) {
      status = `🟢 preço caiu ${Math.abs(diffPercent)}%`;
      changesCount++;
    } else {
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

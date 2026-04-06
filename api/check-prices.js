import dotenv from "dotenv";
dotenv.config();

import { google } from "googleapis";
import axios from "axios";
import puppeteer from "puppeteer";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GOOGLE_SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

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

// 🔥 NOVA FUNÇÃO COM PUPPETEER (FUNCIONA DE VERDADE)
async function fetchPriceAliExpress(url) {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    );

    await page.goto(url, { waitUntil: "domcontentloaded" });

    // espera o preço aparecer
    await page.waitForSelector("[class*='price']", { timeout: 15000 });

    const priceText = await page.evaluate(() => {
      const el =
        document.querySelector("[class*='price-default--current']") ||
        document.querySelector("[class*='price--currentPriceText']");

      return el ? el.innerText : null;
    });

    await browser.close();

    if (!priceText) {
      console.warn("Preço não encontrado com Puppeteer");
      return null;
    }

    const price = parseFloat(
      priceText.replace(/[^\d,\.]/g, "").replace(",", ".")
    );

    return isNaN(price) ? null : price;

  } catch (error) {
    console.error("Erro Puppeteer:", error.message);
    return null;
  }
}

async function sendDiscordMessage(message) {
  try {
    await axios.post(DISCORD_WEBHOOK_URL, { content: message });
  } catch (error) {
    console.error("Erro ao enviar mensagem no Discord:", error.message);
  }
}

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

  for (const row of rows) {
    const productName = row[0];
    const storePriceText = row[2];
    const productLink = row[7];

    if (!productLink || !storePriceText) continue;

    const storePrice = parseFloat(
      storePriceText.replace(/[^\d,\.]/g, "").replace(",", ".")
    );

    if (isNaN(storePrice)) continue;

    const currentPrice = await fetchPriceAliExpress(productLink);

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

  const headerMessage = `🕵️‍♂️ Verificação de preços do AliExpress - Resultado: ${changesCount} produto(s) com alteração`;

  await sendDiscordMessage(`${headerMessage}\n\n${reportMessages.join("\n\n")}`);

  return res.status(200).json({
    message: `Verificação concluída. ${changesCount} produto(s) com alteração.`,
  });
}
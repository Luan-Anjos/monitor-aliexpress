import dotenv from "dotenv";
dotenv.config();

import { google } from "googleapis";
import axios from "axios";
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
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // 🔥 espera render completo
    await new Promise((r) => setTimeout(r, 8000));

    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const result = await page.evaluate(() => {
        const candidates = [];

        const elements = document.querySelectorAll("span, div");

        elements.forEach((el) => {
          const text = el.innerText;

          if (!text) return;

          // pega só valores reais em R$
          if (text.includes("R$")) {
            // ignora parcelas e textos longos
            if (text.includes("x") || text.length > 20) return;

            candidates.push(text);
          }
        });

        return candidates;
      });

      if (result && result.length > 0) {
        // pega o menor valor válido (normalmente é o preço real)
        const prices = result
          .map((text) =>
            parseFloat(
              text.replace(/[^\d,]/g, "").replace(",", ".")
            )
          )
          .filter((p) => !isNaN(p) && p > 1);

        if (prices.length > 0) {
          return Math.min(...prices);
        }
      }

      // tenta de novo
      await new Promise((r) => setTimeout(r, 4000));
      await page.reload({ waitUntil: "networkidle2" });
    }

    console.warn("❌ Preço não encontrado:", url);
    return null;

  } catch (error) {
    console.error("Erro Puppeteer:", error.message);
    return null;
  }
}

// ================= DISCORD =================
async function sendDiscordMessage(message) {
  try {
    await axios.post(DISCORD_WEBHOOK_URL, { content: message });
  } catch (error) {
    console.error("Erro ao enviar mensagem:", error.message);
  }
}

// ================= HANDLER =================
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Método não permitido");
  }

  const rows = await getSheetData();

  if (!rows || rows.length === 0) {
    return res.status(200).send("Nenhum dado encontrado.");
  }

  let reportMessages = [];
  let changesCount = 0;

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
      storePriceText.replace(/[^\d,]/g, "").replace(",", ".")
    );

    if (isNaN(storePrice)) continue;

    console.log("🔎", productName);

    const currentPrice = await fetchPriceAliExpress(page, productLink);

    if (currentPrice === null) {
      reportMessages.push(`⚠️ Não foi possível obter o preço de **${productName}**`);
      continue;
    }

    const diff = currentPrice - storePrice;
    const diffPercent = ((diff / storePrice) * 100).toFixed(2);

    let status = "";

    if (diff === 0) {
      status = "⚪ preço igual";
    } else if (diff < 0) {
      status = `🟢 caiu ${Math.abs(diffPercent)}%`;
      changesCount++;
    } else {
      status = `🔴 subiu ${diffPercent}%`;
      changesCount++;
    }

    reportMessages.push(
      `🛒 **${productName}**
Preço planilha: R$ ${storePrice.toFixed(2)}
Preço atual: R$ ${currentPrice.toFixed(2)}
Status: ${status}
Link: ${productLink}`
    );
  }

  await browser.close();

  const header = `🕵️‍♂️ Verificação - ${changesCount} alteração(ões)`;

  await sendDiscordMessage(`${header}\n\n${reportMessages.join("\n\n")}`);

  return res.status(200).json({
    message: `Finalizado com ${changesCount} alterações`,
  });
}

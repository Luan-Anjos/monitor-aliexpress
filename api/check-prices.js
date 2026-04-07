import dotenv from "dotenv";
dotenv.config();

import fs from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";
import axios from "axios";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GOOGLE_SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

const DEBUG_DIR = path.resolve("./debug");

async function ensureDebugDir() {
  await fs.mkdir(DEBUG_DIR, { recursive: true });
}

function sanitizeFileName(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 80);
}

function parseBrazilianPrice(text) {
  if (!text) return null;

  const normalized = String(text)
    .replace(/\s+/g, " ")
    .trim();

  const match = normalized.match(/R\$\s*([\d.]+,\d{2})/);
  if (!match) return null;

  const value = parseFloat(match[1].replace(/\./g, "").replace(",", "."));
  return Number.isNaN(value) ? null : value;
}

function uniquePricesFromTexts(texts) {
  const seen = new Set();
  const prices = [];

  for (const text of texts) {
    const price = parseBrazilianPrice(text);
    if (price !== null && price > 1 && !seen.has(price)) {
      seen.add(price);
      prices.push(price);
    }
  }

  return prices.sort((a, b) => a - b);
}

// ================= GOOGLE SHEETS =================
async function getSheetData() {
  const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "A2:H",
  });

  return res.data.values || [];
}

// ================= DEBUG HELPERS =================
async function saveDebugArtifacts(page, productName, suffix = "") {
  await ensureDebugDir();

  const safeName = sanitizeFileName(productName || "produto");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `${stamp}-${safeName}${suffix ? `-${suffix}` : ""}`;

  const screenshotPath = path.join(DEBUG_DIR, `${baseName}.png`);
  const htmlPath = path.join(DEBUG_DIR, `${baseName}.html`);

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });

  const html = await page.content();
  await fs.writeFile(htmlPath, html, "utf8");

  return { screenshotPath, htmlPath };
}

async function collectCandidateTexts(page) {
  return await page.evaluate(() => {
    const texts = [];

    const selectors = [
      'meta[property="og:title"]',
      '[class*="price--currentPriceText"]',
      '[class*="price-default--current"]',
      '[class*="uniform-banner-box-price"]',
      '[class*="price-current"]',
      '[class*="price"]',
      "span",
      "div",
    ];

    const pushed = new Set();

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);

      for (const el of elements) {
        const text =
          selector.startsWith("meta")
            ? el.getAttribute("content")
            : el.innerText;

        if (!text) continue;

        const normalized = text.replace(/\s+/g, " ").trim();

        if (
          normalized.includes("R$") &&
          normalized.length <= 80 &&
          !pushed.has(normalized)
        ) {
          pushed.add(normalized);
          texts.push(normalized);
        }
      }
    }

    return texts.slice(0, 100);
  });
}

// ================= PREÇO =================
async function fetchPriceAliExpress(page, url, productName) {
  try {
    console.log("=".repeat(80));
    console.log("🔎 Produto:", productName);
    console.log("🌐 URL:", url);

    await page.setCacheEnabled(false);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(8000);

    const title = await page.title();
    const finalUrl = page.url();

    console.log("📄 Título:", title);
    console.log("🔗 URL final:", finalUrl);

    if (/captcha|punish|interception/i.test(title) || /\/punish\?/i.test(finalUrl)) {
      console.log("🚫 Bloqueio detectado (captcha/punish).");
      const artifacts = await saveDebugArtifacts(page, productName, "blocked");
      console.log("📸 Screenshot:", artifacts.screenshotPath);
      console.log("📄 HTML:", artifacts.htmlPath);
      return null;
    }

    // 1) tenta pegar do JSON interno
    const jsonResult = await page.evaluate(() => {
      const candidates = [];

      const tryPush = (value, source) => {
        if (!value) return;
        candidates.push({ source, value: String(value) });
      };

      try {
        const rp = window.runParams;
        const init = window.__INIT_DATA__;

        const modules = [
          rp?.data?.priceModule,
          rp?.data?.root?.fields?.priceModule,
          init?.data?.priceModule,
          init?.data?.root?.fields?.priceModule,
        ];

        for (const mod of modules) {
          if (!mod) continue;
          tryPush(mod.formatedActivityPrice, "json.formatedActivityPrice");
          tryPush(mod.formatedPrice, "json.formatedPrice");
          tryPush(mod.minActivityAmount?.value, "json.minActivityAmount.value");
          tryPush(mod.minAmount?.value, "json.minAmount.value");
        }
      } catch (_) {}

      return candidates;
    });

    console.log("🧠 Candidatos via JSON:", jsonResult);

    const jsonPrices = uniquePricesFromTexts(jsonResult.map((x) => x.value));
    if (jsonPrices.length > 0) {
      console.log("✅ Preços via JSON:", jsonPrices);
    }

    // 2) tenta pelos elementos visíveis
    const candidateTexts = await collectCandidateTexts(page);
    console.log("💰 Textos com R$ encontrados:", candidateTexts);

    const visiblePrices = uniquePricesFromTexts(candidateTexts);
    console.log("📊 Preços parseados do HTML:", visiblePrices);

    // 3) heurística de escolha
    const allCandidates = [...new Set([...jsonPrices, ...visiblePrices])].sort((a, b) => a - b);

    if (allCandidates.length === 0) {
      console.log("❌ Nenhum preço encontrado.");
      const artifacts = await saveDebugArtifacts(page, productName, "noprice");
      console.log("📸 Screenshot:", artifacts.screenshotPath);
      console.log("📄 HTML:", artifacts.htmlPath);
      return null;
    }

    // prioridade:
    // - se JSON existir, pega o maior preço do JSON (evita pegar "a partir de" muito baixo)
    // - senão pega o maior preço visível razoável
    let chosenPrice = null;

    if (jsonPrices.length > 0) {
      chosenPrice = Math.max(...jsonPrices);
      console.log("🎯 Preço escolhido pelo JSON:", chosenPrice);
    } else {
      chosenPrice = Math.max(...visiblePrices);
      console.log("🎯 Preço escolhido pelo HTML:", chosenPrice);
    }

    const artifacts = await saveDebugArtifacts(page, productName, "ok");
    console.log("📸 Screenshot:", artifacts.screenshotPath);
    console.log("📄 HTML:", artifacts.htmlPath);

    return chosenPrice;
  } catch (error) {
    console.error(`🔥 Erro ao buscar preço (${productName}):`, error.message);
    try {
      const artifacts = await saveDebugArtifacts(page, productName, "error");
      console.log("📸 Screenshot:", artifacts.screenshotPath);
      console.log("📄 HTML:", artifacts.htmlPath);
    } catch {}
    return null;
  }
}

// ================= DISCORD =================
async function sendDiscordMessage(message) {
  try {
    if (!DISCORD_WEBHOOK_URL) {
      console.log("ℹ️ Webhook não configurada. Pulando envio ao Discord.");
      return;
    }

    await axios.post(DISCORD_WEBHOOK_URL, { content: message });
    console.log("📨 Mensagem enviada ao Discord.");
  } catch (error) {
    console.error("Erro ao enviar mensagem:", error.response?.status || error.message);
  }
}

// ================= HANDLER =================
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Método não permitido");
  }

  await ensureDebugDir();

  const rows = await getSheetData();

  if (!rows.length) {
    return res.status(200).send("Nenhum dado encontrado.");
  }

  let reportMessages = [];
  let changesCount = 0;

  const browser = await puppeteer.launch({
    headless: false, // no PC normal vale usar false
    defaultViewport: null,
    args: [
      "--start-maximized",
      "--disable-blink-features=AutomationControlled",
      "--lang=pt-BR",
    ],
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );

  await page.setExtraHTTPHeaders({
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  });

  await page.setViewport({
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
  });

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
    });

    Object.defineProperty(navigator, "languages", {
      get: () => ["pt-BR", "pt", "en-US", "en"],
    });

    Object.defineProperty(navigator, "platform", {
      get: () => "Win32",
    });
  });

  for (const row of rows) {
    const productName = row[0];
    const storePriceText = row[2];
    const productLink = row[7];

    if (!productLink || !storePriceText) continue;

    const storePrice = parseFloat(
      String(storePriceText).replace(/[^\d,]/g, "").replace(",", ".")
    );

    if (Number.isNaN(storePrice)) continue;

    const currentPrice = await fetchPriceAliExpress(page, productLink, productName);

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
  const message = `${header}\n\n${reportMessages.join("\n\n")}`;

  await sendDiscordMessage(message);

  return res.status(200).json({
    message: `Finalizado com ${changesCount} alterações`,
  });
}

import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function sanitizeFileName(name) {
  return String(name || "produto")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export async function saveDebugArtifacts({ page, productName, suffix, debugDir }) {
  await ensureDir(debugDir);

  const safeName = sanitizeFileName(productName);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${stamp}-${safeName}-${suffix}`;

  const screenshotPath = path.join(debugDir, `${base}.png`);
  const htmlPath = path.join(debugDir, `${base}.html`);

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });

  const html = await page.content();
  await fs.writeFile(htmlPath, html, "utf8");

  return { screenshotPath, htmlPath };
}

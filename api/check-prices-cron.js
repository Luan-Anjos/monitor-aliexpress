// api/check-prices-cron.js
import checkPrices from "./check-prices";

export const config = {
  runtime: "nodejs",
  schedule: "0 8,14,20 * * *", // Rodar às 8h, 14h e 20h UTC
};

export default async function handler(req, res) {
  return checkPrices(req, res);
}
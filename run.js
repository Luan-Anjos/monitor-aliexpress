import dotenv from "dotenv";
dotenv.config();

if (!process.env.GOOGLE_SERVICE_ACCOUNT || !process.env.SPREADSHEET_ID || !process.env.DISCORD_WEBHOOK_URL) {
  console.warn("Algumas variáveis de ambiente não estão definidas. Teste local limitado.");
}

import handler from './api/check-prices.js';

handler({ method: "GET" }, {
  status: (code) => ({
    send: (msg) => console.log("send:", msg),
    json: (obj) => console.log("json:", obj),
  }),
});
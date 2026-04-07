import { google } from "googleapis";

export async function getSheetRows(config) {
  const auth = new google.auth.GoogleAuth({
    credentials: config.googleServiceAccount,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: config.googleSheetRange,
  });

  return response.data.values || [];
}

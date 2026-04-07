import axios from "axios";
import { logger } from "../utils/logger.js";

function splitMessage(message, maxLength = 1800) {
  const lines = String(message || "").split("\n");
  const parts = [];
  let current = "";

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;

    if (candidate.length > maxLength) {
      if (current.trim()) parts.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}

export async function sendDiscordReport(webhookUrl, message) {
  if (!webhookUrl) {
    logger.warn("DISCORD_WEBHOOK_URL não configurado. Envio ao Discord ignorado.");
    return { ok: false, skipped: true };
  }

  const parts = splitMessage(message);

  for (const part of parts) {
    try {
      await axios.post(
        webhookUrl,
        { content: part },
        {
          timeout: 15000,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    } catch (error) {
      const status = error?.response?.status;
      const data = error?.response?.data;

      logger.error("Falha ao enviar mensagem ao Discord.", {
        status,
        data,
        error: error.message,
      });

      return {
        ok: false,
        skipped: false,
        error: error.message,
        status,
        data,
      };
    }
  }

  logger.info("Relatório enviado ao Discord com sucesso.");
  return { ok: true };
}

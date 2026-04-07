import axios from "axios";

const DISCORD_LIMIT = 1900;

function chunkMessage(text, maxLength = DISCORD_LIMIT) {
  const chunks = [];
  let current = "";

  for (const block of text.split("\n\n")) {
    const candidate = current ? `${current}\n\n${block}` : block;

    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (block.length <= maxLength) {
      current = block;
      continue;
    }

    for (let i = 0; i < block.length; i += maxLength) {
      chunks.push(block.slice(i, i + maxLength));
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export async function sendDiscordReport(webhookUrl, message, logger) {
  if (!webhookUrl) {
    logger.info("Webhook do Discord não configurada. Relatório não enviado.");
    return;
  }

  const chunks = chunkMessage(message);

  for (const chunk of chunks) {
    await axios.post(webhookUrl, { content: chunk });
  }

  logger.info(`Relatório enviado ao Discord em ${chunks.length} mensagem(ns).`);
}

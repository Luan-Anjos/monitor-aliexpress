import { runMonitor } from "../src/core/monitor.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Método não permitido");
  }

  try {
    const result = await runMonitor();
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    console.error("Erro fatal no monitor:", error);
    return res.status(500).json({
      message: "Falha ao executar o monitor.",
      error: error.message,
    });
  }
}

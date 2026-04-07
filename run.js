import handler from "./api/check-prices.js";

const response = {
  status(code) {
    return {
      send(payload) {
        console.log("STATUS:", code);
        console.log(payload);
      },
      json(payload) {
        console.log("STATUS:", code);
        console.log(JSON.stringify(payload, null, 2));
      },
    };
  },
};

handler({ method: "GET" }, response).catch((error) => {
  console.error("Falha ao executar run.js:", error);
  process.exitCode = 1;
});

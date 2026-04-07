export async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function randomDelay(minMs, maxMs) {
  const min = Number(minMs) || 0;
  const max = Number(maxMs) || min;

  const duration = Math.floor(Math.random() * (max - min + 1)) + min;
  await sleep(duration);
}

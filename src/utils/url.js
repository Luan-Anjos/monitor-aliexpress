export function extractAliExpressProductId(url) {
  const value = String(url || "");

  const patterns = [
    /\/item\/(\d+)\.html/i,
    /\/i\/(\d+)\.html/i,
    /item\/[^/]*?(\d+)\.html/i,
    /[?&]productId=(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

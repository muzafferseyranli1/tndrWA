// Meta kataloğuna salt-okunur bağlantı testi. Jetonu asla ekrana basmaz.
// Çalıştırma: node --env-file=.env scripts/meta-check.mjs

const version = process.env.META_GRAPH_VERSION;
const catalogId = process.env.META_CATALOG_ID;
const token = process.env.META_ACCESS_TOKEN;

const missing = [
  ["META_GRAPH_VERSION", version],
  ["META_CATALOG_ID", catalogId],
  ["META_ACCESS_TOKEN", token],
].filter(([, v]) => !v).map(([k]) => k);

if (missing.length) {
  console.error(`Eksik ortam değişkeni: ${missing.join(", ")}. .env dosyasını doldurun.`);
  process.exit(1);
}

async function graph(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body.error ?? {};
    throw new Error(`HTTP ${res.status} | kod ${e.code ?? "?"} | ${e.error_user_msg ?? e.message ?? "bilinmeyen hata"}`);
  }
  return body;
}

try {
  const catalog = await graph(catalogId, { fields: "id,name,product_count" });
  console.log("Katalog:", catalog);

  const products = await graph(`${catalogId}/products`, {
    fields: "id,retailer_id,name,price,availability",
    limit: "5",
  });
  console.log(`Ürünler (ilk 5): ${products.data.length} kayıt`);
  for (const p of products.data) console.log(" -", p.retailer_id ?? p.id, "|", p.name, "|", p.price);

  console.log("\nTamam: katalog okunabiliyor.");
} catch (err) {
  console.error("Bağlantı başarısız:", err.message);
  process.exit(1);
}

// Tek test ürünüyle yazma yetkisini doğrular: oluştur -> güncelle -> sil.
// Gerçek menü ürünlerine dokunmaz; yalnızca TEST-SIL-BENI kodlu kaydı kullanır.
// Çalıştırma: node --env-file=.env scripts/meta-write-test.mjs
// (Alan adları ve batch biçimi hafızadan yazıldı; Meta dokümanıyla doğrulanmalı.)

const version = process.env.META_GRAPH_VERSION;
const catalogId = process.env.META_CATALOG_ID;
const token = process.env.META_ACCESS_TOKEN;

if (!version || !catalogId || !token) {
  console.error("Eksik ortam değişkeni. .env dosyasını doldurun (META_GRAPH_VERSION, META_CATALOG_ID, META_ACCESS_TOKEN).");
  process.exit(1);
}

const RETAILER_ID = "TEST-SIL-BENI";
const IMAGE = "https://yerindepide.com/wp-content/uploads/2019/05/yerindepide-odun-atesi.jpg";

async function graph(path, { method = "GET", params = {}, form } = {}) {
  const url = new URL(`https://graph.facebook.com/${version}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body.error ?? {};
    throw new Error(`HTTP ${res.status} | kod ${e.code ?? "?"} | ${e.error_user_msg ?? e.message ?? "bilinmeyen hata"}`);
  }
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function batch(label, requests) {
  const out = await graph(`${catalogId}/items_batch`, {
    method: "POST",
    form: { item_type: "PRODUCT_ITEM", requests: JSON.stringify(requests) },
  });
  const handle = out.handles?.[0];
  if (!handle) throw new Error(`${label}: Meta handle döndürmedi: ${JSON.stringify(out)}`);

  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    const st = await graph(`${catalogId}/check_batch_request_status`, { params: { handle, load_ids_of_invalid_requests: "true" } });
    const s = st.data?.[0];
    if (s && s.status && s.status !== "in_progress" && s.status !== "started") {
      const errs = s.errors ?? [];
      console.log(`${label}: durum=${s.status}, hatalı=${s.errors_total_count ?? errs.length}`);
      for (const e of errs) console.log("   hata:", e.message ?? JSON.stringify(e));
      return s;
    }
  }
  throw new Error(`${label}: batch zaman aşımı (handle ${handle}).`);
}

async function findProduct() {
  const out = await graph(`${catalogId}/products`, {
    params: {
      fields: "id,retailer_id,name,price,review_status,visibility",
      filter: JSON.stringify({ retailer_id: { eq: RETAILER_ID } }),
    },
  });
  return out.data?.[0] ?? null;
}

const baseItem = {
  id: RETAILER_ID,
  title: "Test Ürünü (silinecek)",
  description: "Yazma yetkisi testi. Bu ürün birazdan silinecek.",
  availability: "in stock",
  condition: "new",
  price: "1.00 TRY",
  link: "https://yerindepide.com",
  image_link: IMAGE,
  brand: "Yerinde Tandır",
};

try {
  await batch("1) Oluştur", [{ method: "CREATE", data: baseItem }]);
  console.log("   Katalogdaki kayıt:", await findProduct());

  await batch("2) Güncelle (fiyat 2.00 TRY)", [{ method: "UPDATE", data: { id: RETAILER_ID, price: "2.00 TRY" } }]);
  console.log("   Katalogdaki kayıt:", await findProduct());

  await batch("3) Sil", [{ method: "DELETE", data: { id: RETAILER_ID } }]);
  const left = await findProduct();
  console.log(left ? `   UYARI: kayıt hâlâ görünüyor: ${JSON.stringify(left)}` : "   Kayıt silindi.");

  console.log("\nTamam: yazma/güncelleme/silme çalışıyor.");
} catch (err) {
  console.error("Test başarısız:", err.message);
  console.error(`Temizlik gerekirse Commerce Manager'da ${RETAILER_ID} kodlu ürünü silin.`);
  process.exit(1);
}

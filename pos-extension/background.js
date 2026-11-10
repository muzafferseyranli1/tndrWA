// yrndWA POS köprüsü — panel API'sine anahtarla istek atar (POS sayfasının çerezlerinden ve CORS'tan bağımsız).
const config = () => new Promise((r) => chrome.storage.local.get(["panelUrl", "token"], r));

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "options") {
    chrome.runtime.openOptionsPage();
    return false;
  }
  if (msg?.type !== "api") return false;
  (async () => {
    const { panelUrl, token } = await config();
    if (!panelUrl || !token) return reply({ status: 0, error: "Eklenti ayarları eksik: panel adresi ve anahtar girin (Ayarlar)." });
    if (!/^\/api\/pos-ext\//.test(msg.path)) return reply({ status: 0, error: "İzin verilmeyen adres." });
    try {
      const res = await fetch(panelUrl.replace(/\/+$/, "") + msg.path, {
        method: msg.method || "GET",
        headers: { "X-Pos-Token": token, ...(msg.body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: msg.body !== undefined ? JSON.stringify(msg.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      reply({ status: res.status, data });
    } catch (err) {
      reply({ status: 0, error: `Panele ulaşılamadı: ${err.message}` });
    }
  })();
  return true; // yanıt eşzamansız
});

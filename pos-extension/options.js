const $ = (id) => document.getElementById(id);
chrome.storage.local.get(["panelUrl", "token"], (v) => {
  $("url").value = v.panelUrl || "https://yerinde.derinsoft.com.tr";
  $("token").value = v.token || "";
});
$("save").onclick = () => {
  const panelUrl = $("url").value.trim().replace(/\/+$/, "");
  const token = $("token").value.trim();
  if (!/^https:\/\/|^http:\/\/localhost(:\d+)?$/.test(panelUrl)) return ($("out").textContent = "Panel adresi https:// ile başlamalı.");
  chrome.storage.local.set({ panelUrl, token }, () => {
    $("out").textContent = "Kaydedildi, deneniyor…";
    chrome.runtime.sendMessage({ type: "api", method: "GET", path: "/api/pos-ext/brands" }, (r) => {
      if (r && r.status === 200) $("out").textContent = `Bağlantı tamam. Markalar: ${r.data.map((b) => b.name).join(", ")}. POS sayfasını yenileyin.`;
      else $("out").textContent = `Bağlanılamadı: ${(r && (r.data?.error || r.error)) || "bilinmeyen hata"}`;
    });
  });
};

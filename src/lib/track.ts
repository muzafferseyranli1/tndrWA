/** Açılış sayfası sayacı: kişisel veri göndermez, hata sayfayı etkilemez. Sayfa değişirken de kaybolmasın diye sendBeacon kullanılır. */
export function trackHit(hit: { event: "landing" | "brand" | "click"; brand?: string; kind?: string }): void {
  try {
    const body = JSON.stringify(hit);
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/public/hit", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/public/hit", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    }
  } catch {
    /* sayaç hatası görmezden gelinir */
  }
}

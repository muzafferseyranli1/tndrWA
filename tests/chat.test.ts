import assert from "node:assert/strict";
import { test } from "node:test";
import { describeInbound, sendFailureText } from "../server/services/chat";

test("gelen mesaj türleri panelde okunur metne çevrilir", () => {
  assert.deepEqual(describeInbound({ type: "text", text: { body: "Merhaba" } }), { type: "text", body: "Merhaba" });
  assert.deepEqual(describeInbound({ type: "image", image: { caption: "bakın" } }), { type: "image", body: "[Görsel] bakın" });
  assert.deepEqual(describeInbound({ type: "audio", audio: {} }), { type: "audio", body: "[Ses kaydı]" });
  assert.deepEqual(describeInbound({ type: "interactive", interactive: { button_reply: { title: "Evet" } } }), { type: "interactive", body: "Evet" });
  assert.deepEqual(describeInbound({ type: "button", button: { text: "Menü" } }), { type: "button", body: "Menü" });
  assert.deepEqual(describeInbound({ type: "location", location: {} }), { type: "location", body: "[Konum]" });
  assert.deepEqual(describeInbound({ type: "yeni_tur" }), { type: "yeni_tur", body: "[yeni_tur]" });
  assert.deepEqual(describeInbound(null), { type: "unknown", body: "[unknown]" });
});

test("gönderim hataları personelin anlayacağı dille söylenir", () => {
  assert.match(sendFailureText("Re-engagement message", 131047), /24 saat penceresi/);
  assert.match(sendFailureText("x", 131030), /test listesinde değil/);
  assert.equal(sendFailureText("Başka hata", 100), "Başka hata");
});

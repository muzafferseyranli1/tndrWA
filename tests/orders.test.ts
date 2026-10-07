import assert from "node:assert/strict";
import { test } from "node:test";
import { contactFrom } from "../server/services/customers";

test("müşteri: telefon, BSUID ve profil adı webhook'tan okunur", () => {
  const c = contactFrom({ contacts: [{ profile: { name: " Muzaffer " }, wa_id: "905332760534", user_id: "TR.1" }], message: { from: "905332760534" } });
  assert.deepEqual(c, { waId: "905332760534", bsuid: "TR.1", name: "Muzaffer" });
});

test("müşteri: kişi bloğu yoksa mesajdaki from alanı, telefonsuzda yalnızca BSUID", () => {
  assert.deepEqual(contactFrom({ message: { from: "905551112233", from_user_id: "TR.2" } }), { waId: "905551112233", bsuid: "TR.2", name: null });
  assert.deepEqual(contactFrom({ contacts: [{ user_id: "TR.3" }], message: {} }), { waId: null, bsuid: "TR.3", name: null });
  assert.deepEqual(contactFrom(null), { waId: null, bsuid: null, name: null });
});

import { DEFAULT_TEMPLATES, renderTemplate } from "../server/services/order-messages";

test("mesaj şablonu: ad ve sipariş numarası yerleşir, adsız müşteride 'Merhaba ,' kalmaz", () => {
  assert.equal(renderTemplate(DEFAULT_TEMPLATES.NEW, { ad: "Muzaffer", no: 12 }), "Merhaba Muzaffer, siparişinizi aldık (No: 12). Hazırlanmaya başlayınca haber vereceğiz.");
  assert.equal(renderTemplate(DEFAULT_TEMPLATES.NEW, { ad: null, no: 12 }), "Merhaba, siparişinizi aldık (No: 12). Hazırlanmaya başlayınca haber vereceğiz.");
  assert.equal(renderTemplate("{no} {no}", { ad: "x", no: 5 }), "5 5");
});

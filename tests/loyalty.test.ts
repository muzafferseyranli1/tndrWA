import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasSelection, introText, offerFromCustomer, offerIsEmpty, parseLoyalty, remainingChoices, selectionSummary, serializeLoyalty, type LoyaltyState } from "../server/services/loyalty";
import { timeoutAction, REPLY_TIMEOUT_MS } from "../server/services/order-timeouts";

const customer = {
  loyalty: {
    points: 1250,
    redeemablePoints: 1200,
    pointValue: 0.1,
    coupons: [
      { id: "k1", name: "%20 İndirim", type: "percent", percent: 20, maxAmount: 150, selectable: true },
      { id: "k2", name: "Kampanya kuponu", type: "campaign", selectable: false },
      { id: "k3", name: "Seçilemez", type: "amount", amount: 50, selectable: false },
    ],
    giftRights: [{ id: "g1", name: "10. ziyaret", items: [{ name: "Sütlaç", qty: 1 }], selectable: true }],
  },
};

describe("loyalty seçenekleri", () => {
  it("yalnız seçilebilir kupon, harcanabilir puan ve hediye hakkını sunar", () => {
    const o = offerFromCustomer(customer);
    assert.deepEqual(o.coupons.map((c) => c.id), ["k1"]);
    assert.match(o.coupons[0].detail, /%20 indirim, en çok 150,00/);
    assert.deepEqual(o.points, { redeemable: 1200, pointValue: 0.1 });
    assert.deepEqual(o.gifts.map((g) => g.id), ["g1"]);
  });

  it("puan dönüşüm oranı 0 ise (puan harcama kapalı) puan sunulmaz; hiçbir hak yoksa teklif boştur", () => {
    assert.equal(offerFromCustomer({ loyalty: { points: 900, redeemablePoints: 0, pointValue: 0 } }).points, null);
    assert.ok(offerIsEmpty(offerFromCustomer({ loyalty: { points: 900, redeemablePoints: 900, pointValue: 0, coupons: [{ id: "c", name: "K", type: "campaign", selectable: false }] } })));
    assert.ok(offerIsEmpty(offerFromCustomer(null)));
    assert.ok(offerIsEmpty(offerFromCustomer({ loyalty: null })));
  });

  it("kalan seçenekler: seçileni çıkarır, her zaman tamamla satırı vardır ve en çok 10 satır", () => {
    const offer = offerFromCustomer(customer);
    const st: LoyaltyState = { offer, sel: {}, discountKurus: 0 };
    assert.deepEqual(remainingChoices(st).map((r) => r.id), ["pts", "c0", "g0", "done"]);
    assert.equal(remainingChoices(st).at(-1)!.title, "Kullanmayacağım");
    const picked: LoyaltyState = { ...st, sel: { couponId: "k1", pointsToRedeem: 100 }, discountKurus: 1000 };
    assert.deepEqual(remainingChoices(picked).map((r) => r.id), ["g0", "done"]);
    assert.equal(remainingChoices(picked).at(-1)!.title, "Hayır, tamamla");
    assert.ok(remainingChoices(st).every((r) => r.title.length <= 24 && (r.description ?? "").length <= 72));
  });

  it("seçim özeti ve metinler", () => {
    const offer = offerFromCustomer(customer);
    const st: LoyaltyState = { offer, sel: { couponId: "k1", pointsToRedeem: 300 }, discountKurus: 5000, pointsUsed: 300 };
    assert.equal(selectionSummary(st), "kupon %20 İndirim + 300 puan");
    assert.ok(hasSelection(st.sel));
    assert.ok(!hasSelection({}));
    assert.match(introText({ offer, sel: {}, discountKurus: 0 }, "Ayşe"), /^Ayşe, siparişinizde kullanabileceğiniz 1200 puanınız/);
  });

  it("sipariş alanında saklanıp geri okunur; bozuk/boş değer null", () => {
    const st: LoyaltyState = { offer: offerFromCustomer(customer), sel: { couponId: "k1" }, discountKurus: 100 };
    assert.deepEqual(parseLoyalty(serializeLoyalty(st)), st);
    assert.equal(parseLoyalty(null), null);
    assert.equal(parseLoyalty("{bozuk"), null);
  });
});

describe("kupon/puan sorusu zaman aşımı", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const base = { status: "NEW", stage: "AWAITING_LOYALTY", promptedAt: new Date(now.getTime() - REPLY_TIMEOUT_MS - 1000), reminderSentAt: null };
  it("yanıt gelmezse sipariş iptal edilmez, kupon/puan kullanılmadan tamamlanır", () => {
    assert.equal(timeoutAction(base, now), "skip-loyalty");
    assert.equal(timeoutAction({ ...base, promptedAt: new Date(now.getTime() - 1000) }, now), null);
  });
  it("diğer aşamalarda eski davranış: hatırlat, sonra iptal", () => {
    assert.equal(timeoutAction({ ...base, stage: "AWAITING_ADDRESS" }, now), "remind");
    assert.equal(timeoutAction({ ...base, stage: "AWAITING_ADDRESS", reminderSentAt: new Date(now.getTime() - REPLY_TIMEOUT_MS - 1000) }, now), "cancel");
  });
});

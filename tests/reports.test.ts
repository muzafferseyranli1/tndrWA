import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, buildReport, istanbulDayStart, istanbulParts, type ReportOrder } from "../shared/reports";

const at = (iso: string) => new Date(iso);
const order = (over: Partial<ReportOrder>): ReportOrder => ({
  createdAt: at("2026-10-12T10:00:00+03:00"),
  status: "DELIVERED",
  stage: "READY",
  totalKurus: 100000,
  discountKurus: 15000,
  paymentLabel: "Nakit",
  customerId: 1,
  items: [{ name: "Pide", quantity: 2, unitKurus: 40000, extraKurus: 0 }],
  ...over,
});

test("gün ve saat İstanbul'a göre hesaplanır (gece yarısı sınırı)", () => {
  assert.deepEqual(istanbulParts(at("2026-10-12T23:30:00+03:00")), { date: "2026-10-12", hour: 23 });
  assert.deepEqual(istanbulParts(at("2026-10-13T00:10:00+03:00")), { date: "2026-10-13", hour: 0 });
  assert.equal(istanbulDayStart("2026-10-13").toISOString(), "2026-10-12T21:00:00.000Z");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
});

test("ciro indirimi düşer; iptal ve tamamlanmayan sepet ciroya girmez", () => {
  const r = buildReport([order({}), order({ customerId: 2 }), order({ status: "CANCELLED" }), order({ stage: "AWAITING_ADDRESS" })], "2026-10-12", "2026-10-12", new Map());
  assert.equal(r.summary.orders, 2);
  assert.equal(r.summary.cancelled, 1);
  assert.equal(r.summary.incomplete, 1);
  assert.equal(r.summary.revenueKurus, 170000);
  assert.equal(r.summary.discountKurus, 30000);
  assert.equal(r.summary.avgBasketKurus, 85000);
  assert.equal(r.summary.customers, 2);
});

test("günlük dağılım, saat ve ödeme şekli", () => {
  const r = buildReport([order({}), order({ createdAt: at("2026-10-13T19:05:00+03:00"), paymentLabel: "Kapıda kredi kartı" })], "2026-10-12", "2026-10-13", new Map());
  assert.deepEqual(
    r.daily.map((d) => [d.date, d.orders]),
    [
      ["2026-10-12", 1],
      ["2026-10-13", 1],
    ],
  );
  assert.equal(r.hourly[10], 1);
  assert.equal(r.hourly[19], 1);
  assert.deepEqual(r.payments.map((p) => p.label).sort(), ["Kapıda kredi kartı", "Nakit"]);
});

test("ürünler adede göre sıralanır, ekstra ücret dahil", () => {
  const r = buildReport(
    [
      order({
        items: [
          { name: "A", quantity: 1, unitKurus: 10000, extraKurus: 1000 },
          { name: "B", quantity: 3, unitKurus: 5000, extraKurus: 0 },
        ],
      }),
    ],
    "2026-10-12",
    "2026-10-12",
    new Map(),
  );
  assert.deepEqual(
    r.products.map((p) => [p.name, p.quantity, p.revenueKurus]),
    [
      ["B", 3, 15000],
      ["A", 1, 11000],
    ],
  );
});

test("yeni müşteri: ilk siparişi seçilen aralıkta olanlar", () => {
  const r = buildReport(
    [order({ customerId: 1 }), order({ customerId: 2 })],
    "2026-10-12",
    "2026-10-12",
    new Map([
      [1, "2026-10-12"],
      [2, "2026-09-01"],
    ]),
  );
  assert.equal(r.summary.customers, 2);
  assert.equal(r.summary.newCustomers, 1);
});

test("sipariş yokken sıfırlar ve boş günler", () => {
  const r = buildReport([], "2026-10-10", "2026-10-12", new Map());
  assert.equal(r.summary.orders, 0);
  assert.equal(r.summary.avgBasketKurus, 0);
  assert.equal(r.daily.length, 3);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { planMenuList } from "../server/services/menu-message";

const now = new Date("2026-11-07T12:00:00Z");
const p = (retailerId: string, categoryId: number | null, extra: Partial<{ status: "ACTIVE" | "PASSIVE"; soldOutUntil: Date | null; onMeta: boolean }> = {}) => ({
  retailerId,
  categoryId,
  status: "ACTIVE" as const,
  soldOutUntil: null,
  onMeta: true,
  ...extra,
});

test("menü listesi: kategoriler ve ürünler verilen sırada, boş kategori atlanır", () => {
  const plan = planMenuList(
    [
      { id: 3, name: "Tandır Sandviçler" },
      { id: 9, name: "Pilavlar" },
      { id: 1, name: "İçecekler" },
    ],
    [p("ayran", 1), p("sandvic-b", 3), p("sandvic-a", 3), p("su", 1)],
    now,
  );
  assert.deepEqual(plan.sections, [
    { title: "Tandır Sandviçler", retailerIds: ["sandvic-b", "sandvic-a"] },
    { title: "İçecekler", retailerIds: ["ayran", "su"] },
  ]);
  assert.equal(plan.items, 4);
  assert.equal(plan.fits, true);
  assert.equal(plan.reason, null);
});

test("menü listesi: katalogda olmayan, pasif ve bugün tükenen ürünler girmez; tükenme süresi geçmişse girer", () => {
  const plan = planMenuList(
    [{ id: 1, name: "İçecekler" }],
    [
      p("ayran", 1),
      p("metasiz", 1, { onMeta: false }),
      p("pasif", 1, { status: "PASSIVE" }),
      p("tukendi", 1, { soldOutUntil: new Date("2026-11-08T02:00:00Z") }),
      p("geri-acildi", 1, { soldOutUntil: new Date("2026-11-07T02:00:00Z") }),
    ],
    now,
  );
  assert.deepEqual(plan.sections, [{ title: "İçecekler", retailerIds: ["ayran", "geri-acildi"] }]);
});

test("menü listesi: kategorisiz ürünler sona 'Diğer' bölümüne, uzun kategori adı 24 karaktere kısalır", () => {
  const plan = planMenuList([{ id: 1, name: "Kuzu Tandırlı Karadeniz Pideleri" }], [p("x", 1), p("y", null), p("z", 42)], now);
  assert.equal(plan.sections.length, 2);
  assert.ok(plan.sections[0].title.length <= 24, plan.sections[0].title);
  assert.ok(plan.sections[0].title.endsWith("…"));
  assert.deepEqual(plan.sections[1], { title: "Diğer", retailerIds: ["y", "z"] });
});

test("menü listesi: WhatsApp sınırları aşılırsa gönderilemez (10 bölüm, 30 ürün, boş liste)", () => {
  const cats = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, name: `K${i + 1}` }));
  const tooManySections = planMenuList(cats, cats.map((c) => p(`u${c.id}`, c.id)), now);
  assert.equal(tooManySections.fits, false);
  assert.match(tooManySections.reason ?? "", /11 kategori/);

  const tooManyItems = planMenuList([{ id: 1, name: "Pideler" }], Array.from({ length: 31 }, (_, i) => p(`pide-${i}`, 1)), now);
  assert.equal(tooManyItems.fits, false);
  assert.match(tooManyItems.reason ?? "", /31 ürün/);

  const exactly30 = planMenuList([{ id: 1, name: "Pideler" }], Array.from({ length: 30 }, (_, i) => p(`pide-${i}`, 1)), now);
  assert.equal(exactly30.fits, true);

  const empty = planMenuList([{ id: 1, name: "Pideler" }], [p("x", 1, { onMeta: false })], now);
  assert.equal(empty.fits, false);
  assert.match(empty.reason ?? "", /ürün yok/);
});

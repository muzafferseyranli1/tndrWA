import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryPage, chunkItems, planMenuList, type MenuSection } from "../server/services/menu-message";

const brief = (sections: MenuSection[]) => sections.map((s) => ({ title: s.title, retailerIds: s.retailerIds }));

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
  assert.deepEqual(brief(plan.sections), [
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
  assert.deepEqual(brief(plan.sections), [{ title: "İçecekler", retailerIds: ["ayran", "geri-acildi"] }]);
});

test("menü listesi: kategorisiz ürünler sona 'Diğer' bölümüne, uzun kategori adı 24 karaktere kısalır", () => {
  const plan = planMenuList([{ id: 1, name: "Kuzu Tandırlı Karadeniz Pideleri" }], [p("x", 1), p("y", null), p("z", 42)], now);
  assert.equal(plan.sections.length, 2);
  assert.ok(plan.sections[0].title.length <= 24, plan.sections[0].title);
  assert.ok(plan.sections[0].title.endsWith("…"));
  assert.deepEqual(brief(plan.sections)[1], { title: "Diğer", retailerIds: ["y", "z"] });
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

test("kategori listesi: 10 kategoriye kadar tek sayfa; fazlasında 9 kategori + 'Diğer kategoriler', son sayfada kalanlar", () => {
  const secs = (n: number): MenuSection[] => Array.from({ length: n }, (_, i) => ({ categoryId: i + 1, name: `Kategori ${i + 1}`, title: `Kategori ${i + 1}`, retailerIds: ["a", "b"] }));
  const ten = categoryPage(secs(10), 1);
  assert.equal(ten.pages, 1);
  assert.equal(ten.rows.length, 10);
  assert.ok(ten.rows.every((r) => r.id.startsWith("menu:cat:")));
  const p1 = categoryPage(secs(13), 1);
  assert.equal(p1.pages, 2);
  assert.equal(p1.rows.length, 10);
  assert.deepEqual(p1.rows.at(-1), { id: "menu:page:2", title: "Diğer kategoriler ▶", description: "4 kategori daha" });
  assert.equal(p1.rows[0].description, "2 ürün");
  const p2 = categoryPage(secs(13), 2);
  assert.deepEqual(p2.rows.map((r) => r.id), ["menu:cat:10", "menu:cat:11", "menu:cat:12", "menu:cat:13"]);
  const big = categoryPage(secs(25), 2);
  assert.equal(big.pages, 3);
  assert.equal(big.rows.at(-1)?.id, "menu:page:3");
  assert.equal(categoryPage(secs(25), 3).rows.length, 7);
  // Kategorisiz ürünler ("Diğer") listede seçilemez, sayılmaz
  assert.equal(categoryPage([...secs(2), { categoryId: null, name: "Diğer", title: "Diğer", retailerIds: ["x"] }], 1).rows.length, 2);
});

test("ürün listesi 30'luk parçalara bölünür", () => {
  const ids = Array.from({ length: 36 }, (_, i) => `u${i}`);
  assert.deepEqual(chunkItems(ids).map((c) => c.length), [30, 6]);
  assert.deepEqual(chunkItems(ids.slice(0, 30)).map((c) => c.length), [30]);
  assert.deepEqual(chunkItems([]), []);
});

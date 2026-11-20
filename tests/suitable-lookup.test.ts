import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { SuitableClient } from "../server/services/suitable-api";
import { SuitableSync } from "../server/services/suitable-sync";

const CFG = { baseUrl: "https://api.test/v1", apiKey: "swk_x_y", webhookSecret: null, stores: {}, priceMode: "platform" as const, source: "panel" as const };

function fakeFetch(handler: (url: URL) => { status: number; body?: unknown }): { fn: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    urls.push(u.pathname + u.search);
    const r = handler(u);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, urls };
}

describe("SuitableClient.getCustomer", () => {
  it("telefonu +90 biçimine çevirir, 404'te null döner", async () => {
    const f = fakeFetch((u) => (u.searchParams.get("phone") === "+905321234567" ? { status: 200, body: { name: "Ayşe", addresses: [] } } : { status: 404, body: { error: { code: "not_found", message: "yok" } } }));
    const c = new SuitableClient({ baseUrl: CFG.baseUrl, apiKey: CFG.apiKey }, f.fn);
    assert.equal((await c.getCustomer("S1", "905321234567"))?.name, "Ayşe");
    assert.equal(await c.getCustomer("S1", "905000000000"), null);
    assert.match(f.urls[0], /^\/v1\/customers\?store=S1&phone=%2B905321234567$/);
  });

  it("yetki hatası (403) fırlatılır", async () => {
    const f = fakeFetch(() => ({ status: 403, body: { error: { code: "forbidden", message: "customers:read yok" } } }));
    const c = new SuitableClient({ baseUrl: CFG.baseUrl, apiKey: CFG.apiKey }, f.fn);
    await assert.rejects(() => c.getCustomer("S1", "905321234567"), /customers:read/);
  });
});

describe("SuitableSync.lookupCustomer", () => {
  function setup(opts: { mode?: string; existing?: string[]; name?: string | null }) {
    const created: { key: string; text: string }[] = [];
    const changes: string[] = [];
    let nameSet: string | null = null;
    const existing = (opts.existing ?? []).map((key) => ({ key }));
    const db = {
      setting: { findUnique: async () => ({ value: opts.mode ?? "api" }) },
      order: { findUnique: async () => ({ id: 7, customerId: 3, brand: { code: "tandir", posCafeId: "S1" }, customer: { id: 3, waId: "905321234567", name: opts.name ?? null } }) },
      customerAddress: { findMany: async () => existing, create: async ({ data }: { data: { key: string; text: string } }) => void created.push(data) },
      customer: { update: async ({ data }: { data: { name: string } }) => void (nameSet = data.name) },
      orderChange: { findFirst: async () => null, create: async ({ data }: { data: { text: string } }) => void changes.push(data.text) },
    } as unknown as PrismaClient;
    const sync = new SuitableSync(db, null, null, null);
    sync.cfg = CFG;
    return { sync, created, changes, getName: () => nameSet };
  }
  const body = {
    name: "Ayşe Yılmaz",
    addresses: [
      { title: "Ev", text: "Bağdat Cd. No:12", neighborhood: "Suadiye Mah.", district: "Kadıköy", city: "İstanbul", lat: 40.9, lng: 29.0 },
      { title: "İş", text: "Atatürk Cd. No 5", neighborhood: "", district: "", city: "" },
    ],
    loyalty: { points: 1250, tier: "Altın", coupons: [{ id: "k1", name: "%20", type: "percent" }], stampCards: [{ campaignId: "c1", name: "Kahve kartı", type: "product", target: 10, progress: 4 }] },
  };

  it("kayıtlı adresleri ekler (yineleneni atar), boş adı doldurur, sadakati not düşer", async () => {
    const s = setup({ existing: ["atatürk cd. no 5, kadıköy"] });
    s.sync.client = new SuitableClient({ baseUrl: CFG.baseUrl, apiKey: CFG.apiKey }, fakeFetch(() => ({ status: 200, body })).fn);
    const r = await s.sync.lookupCustomer(7);
    assert.equal(r?.name, "Ayşe Yılmaz");
    assert.equal(s.created.length, 1, "var olan adres yinelenmedi");
    assert.match(s.created[0].text, /Bağdat Cd\. No:12/);
    assert.equal(s.getName(), "Ayşe Yılmaz");
    assert.match(s.changes[0], /seviye Altın, 1250 puan, 1 kupon, Kahve kartı 4\/10/);
  });

  it("eklenti yöntemindeyken Suitable'a sormaz", async () => {
    const s = setup({ mode: "extension" });
    const f = fakeFetch(() => ({ status: 200, body }));
    s.sync.client = new SuitableClient({ baseUrl: CFG.baseUrl, apiKey: CFG.apiKey }, f.fn);
    assert.equal(await s.sync.lookupCustomer(7), null);
    assert.equal(f.urls.length, 0);
  });

  it("yetki yoksa (403) sessizce atlar ve bir süre tekrar denemez", async () => {
    const s = setup({});
    const f = fakeFetch(() => ({ status: 403, body: { error: { code: "forbidden", message: "yok" } } }));
    s.sync.client = new SuitableClient({ baseUrl: CFG.baseUrl, apiKey: CFG.apiKey }, f.fn);
    assert.equal(await s.sync.lookupCustomer(7), null);
    assert.equal(await s.sync.lookupCustomer(7), null);
    assert.equal(f.urls.length, 1, "ikinci çağrıda Suitable'a gidilmedi");
  });

  it("müşteri kayıtlı değilse (404) null", async () => {
    const s = setup({});
    s.sync.client = new SuitableClient({ baseUrl: CFG.baseUrl, apiKey: CFG.apiKey }, fakeFetch(() => ({ status: 404, body: { error: { code: "not_found", message: "yok" } } })).fn);
    assert.equal(await s.sync.lookupCustomer(7), null);
    assert.equal(s.created.length, 0);
  });
});

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { formatTRY } from "@shared/money";

/* ---- Sunucu sözleşmesi (server/services/telegram-app.ts AppMenu) ---- */
interface Choice { id: number; name: string; extraKurus: number }
interface Group { id: number; name: string; required: boolean; maxSelect: number; choices: Choice[] }
interface Variant { id: number; label: string | null; priceKurus: number; groupIds: number[] }
interface Product { key: string; name: string; description: string; image: string | null; variants: Variant[] }
interface Category { id: number; name: string; products: Product[] }
interface Menu {
  brand: { code: string; name: string };
  state: "open" | "pre" | "closed";
  stateText: string | null;
  minBasketKurus: number;
  discounts: { name: string; percent: number }[];
  groups: Record<number, Group>;
  categories: Category[];
  me: { needsPhone: boolean; name: string | null } | null;
}

interface Line {
  id: string; // varyant + seçenekler
  productKey: string;
  productId: number;
  name: string;
  variantLabel: string | null;
  options: { groupId: number; choiceIds: number[] }[];
  optionText: string;
  unitKurus: number;
  qty: number;
}

interface TgWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  close(): void;
  requestContact?(cb: (shared: boolean) => void): void;
  HapticFeedback?: { impactOccurred(s: string): void; notificationOccurred(s: string): void };
  MainButton?: unknown;
}
declare global {
  interface Window { Telegram?: { WebApp?: TgWebApp } }
}

const MAX_QTY = 20;
const FLY_COLOR = "#7c3aed"; // yemek fotoğraflarında bulunmayan canlı mor

const lineKey = (productId: number, options: { groupId: number; choiceIds: number[] }[]) =>
  `${productId}|${options.filter((o) => o.choiceIds.length).map((o) => `${o.groupId}:${[...o.choiceIds].sort((a, b) => a - b).join(",")}`).sort().join(";")}`;

const newRequestId = () => {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
};

function haptic(kind: "light" | "success" | "error") {
  try {
    const h = window.Telegram?.WebApp?.HapticFeedback;
    if (!h) return;
    if (kind === "light") h.impactOccurred("light");
    else h.notificationOccurred(kind);
  } catch { /* titreşim yoksa sorun değil */ }
}

/** Büyük başlayıp sepete doğru uçarken küçülen daire */
function fly(from: DOMRect, to: DOMRect | null, onDone: () => void) {
  if (!to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    onDone();
    return;
  }
  const size = Math.max(40, Math.min(72, Math.min(from.width, from.height) || 56));
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "fixed", left: "0", top: "0", width: `${size}px`, height: `${size}px`, borderRadius: "50%",
    background: FLY_COLOR, border: "3px solid #fff", boxShadow: `0 4px 18px ${FLY_COLOR}99`, zIndex: "9999", pointerEvents: "none", willChange: "transform, opacity",
  });
  document.body.appendChild(el);
  const sx = from.left + from.width / 2 - size / 2;
  const sy = from.top + from.height / 2 - size / 2;
  const ex = to.left + to.width / 2 - size / 2;
  const ey = to.top + to.height / 2 - size / 2;
  const mx = sx + (ex - sx) * 0.55;
  const my = Math.min(sy, ey) - 50; // hafif yay
  const anim = el.animate(
    [
      { transform: `translate(${sx}px, ${sy}px) scale(1)`, opacity: 0.95 },
      { transform: `translate(${mx}px, ${my}px) scale(0.55)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${ex}px, ${ey}px) scale(0.12)`, opacity: 0.9 },
    ],
    { duration: 650, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
  );
  const end = () => { el.remove(); onDone(); };
  anim.onfinish = end;
  anim.oncancel = end;
}

export default function MiniAppPage() {
  const { code } = useParams<{ code: string }>();
  const brandCode = String(code ?? "").toLowerCase();

  const [menu, setMenu] = useState<Menu | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [sheet, setSheet] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [bump, setBump] = useState(0);
  const [tgReady, setTgReady] = useState(false);

  const cartTarget = useRef<HTMLDivElement | null>(null);
  const requestId = useRef(newRequestId());
  const storageKey = `tg-cart:${brandCode}`;

  /* Telegram betiği */
  useEffect(() => {
    const init = () => {
      try { window.Telegram?.WebApp?.ready(); window.Telegram?.WebApp?.expand(); } catch { /* */ }
      setTgReady(true);
    };
    if (window.Telegram?.WebApp) { init(); return; }
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.onload = init;
    s.onerror = init;
    document.head.appendChild(s);
  }, []);

  const loadMenu = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData ?? "";
    const res = await fetch(`/api/tg/menu?brand=${encodeURIComponent(brandCode)}`, { headers: initData ? { "x-telegram-init-data": initData } : {}, cache: "no-store" });
    if (!res.ok) throw new Error(res.status === 404 ? "Bu marka için Telegram menüsü açık değil." : "Menü yüklenemedi.");
    return (await res.json()) as Menu;
  }, [brandCode]);

  useEffect(() => {
    if (!tgReady) return;
    loadMenu().then(setMenu).catch((e: Error) => setLoadError(e.message));
  }, [tgReady, loadMenu]);

  /* Sepeti oturum boyunca sakla (Mini App kapanıp açılırsa kaybolmasın) */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) setCart(JSON.parse(raw) as Line[]);
    } catch { /* */ }
  }, [storageKey]);
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(cart)); } catch { /* */ }
  }, [cart, storageKey]);

  /* Menü yenilenince menüde olmayan (kalkmış) satırları ayıkla */
  useEffect(() => {
    if (!menu) return;
    const ids = new Set(menu.categories.flatMap((c) => c.products.flatMap((p) => p.variants.map((v) => v.id))));
    setCart((c) => (c.every((l) => ids.has(l.productId)) ? c : c.filter((l) => ids.has(l.productId))));
  }, [menu]);

  const changeCart = (fn: (c: Line[]) => Line[]) => {
    setCart(fn);
    requestId.current = newRequestId(); // sepet değişti: yeni sipariş denemesi
    setError(null);
  };

  const totalQty = cart.reduce((n, l) => n + l.qty, 0);
  const totalKurus = cart.reduce((n, l) => n + l.qty * l.unitKurus, 0);
  const closed = menu?.state === "closed";

  const addLine = (line: Omit<Line, "qty">, qty: number, from: DOMRect | null) => {
    haptic("light");
    const apply = () => {
      changeCart((c) => {
        const i = c.findIndex((l) => l.id === line.id);
        if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) } : l));
        return [...c, { ...line, qty }];
      });
      setBump((b) => b + 1);
    };
    if (from) fly(from, cartTarget.current?.getBoundingClientRect() ?? null, apply);
    else apply();
  };

  const setQty = (id: string, qty: number) => changeCart((c) => (qty <= 0 ? c.filter((l) => l.id !== id) : c.map((l) => (l.id === id ? { ...l, qty: Math.min(MAX_QTY, qty) } : l))));

  const qtyOfProduct = (p: Product) => cart.filter((l) => l.productKey === p.key).reduce((n, l) => n + l.qty, 0);

  /* Tek porsiyon + seçeneksiz ürün: doğrudan ekle/çıkar */
  const simpleLine = (p: Product): Omit<Line, "qty"> | null => {
    const v = p.variants[0];
    if (p.variants.length !== 1 || v.groupIds.length) return null;
    return { id: lineKey(v.id, []), productKey: p.key, productId: v.id, name: p.name, variantLabel: v.label, options: [], optionText: "", unitKurus: v.priceKurus };
  };

  const submit = async () => {
    if (!menu || busy || !cart.length) return;
    setBusy(true);
    setError(null);
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData) {
      setError("Sipariş vermek için bu sayfayı Telegram'daki botun menü düğmesinden açın.");
      setBusy(false);
      return;
    }
    const send = async () => {
      const res = await fetch("/api/tg/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brand: brandCode,
          initData,
          requestId: requestId.current,
          note: note.trim() || undefined,
          items: cart.map((l) => ({ productId: l.productId, quantity: l.qty, options: l.options })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string; error?: string };
      return { res, body };
    };
    try {
      let { res, body } = await send();
      if (res.status === 409 && body.code === "phone" && window.Telegram?.WebApp?.requestContact) {
        // Telefon yoksa Telegram'ın paylaşım penceresi açılır; numara bota gelince kayıt birleşir
        const shared = await new Promise<boolean>((resolve) => window.Telegram!.WebApp!.requestContact!((s) => resolve(!!s)));
        if (shared) {
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 1200));
            const m = await loadMenu().catch(() => null);
            if (m && m.me && !m.me.needsPhone) break;
          }
          ({ res, body } = await send());
        }
      }
      if (res.ok && body.ok) {
        haptic("success");
        setDone(true);
        setCart([]);
        try { sessionStorage.removeItem(storageKey); } catch { /* */ }
        setTimeout(() => { try { window.Telegram?.WebApp?.close(); } catch { /* */ } }, 1600);
        return;
      }
      haptic("error");
      if (body.code === "phone") setError("Siparişi alabilmemiz için sohbetteki düğmeyle telefon numaranızı paylaşın, sonra tekrar deneyin.");
      else if (body.code === "closed") setError("Şu an sipariş alınmıyor. Ayrıntı sohbete yazıldı.");
      else if (body.code === "minBasket") setError("Sepet tutarı minimum tutarın altında. Ayrıntı sohbete yazıldı.");
      else setError(body.error ?? "Sipariş gönderilemedi. Lütfen tekrar deneyin.");
    } catch {
      haptic("error");
      setError("Bağlantı kurulamadı. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  };

  const catRefs = useRef<Record<number, HTMLElement | null>>({});

  if (loadError) return <Shell><p className="p-6 text-center text-sm">{loadError}</p></Shell>;
  if (!menu) return <Shell><p className="p-6 text-center text-sm opacity-70">Menü yükleniyor…</p></Shell>;

  if (done)
    return (
      <Shell>
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full text-3xl text-white" style={{ background: FLY_COLOR }}>✓</div>
          <p className="text-lg font-semibold">Siparişiniz alındı</p>
          <p className="text-sm opacity-70">Ödeme ve adres adımlarına sohbetten devam edeceğiz.</p>
          <button className="mt-2 rounded-xl px-5 py-2.5 text-sm font-medium" style={{ background: "var(--btn)", color: "var(--btn-text)" }} onClick={() => window.Telegram?.WebApp?.close()}>Sohbete dön</button>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <header className="px-4 pb-1 pt-4">
        <h1 className="text-xl font-bold">{menu.brand.name}</h1>
        {menu.state !== "open" && menu.stateText && (
          <p className={`mt-2 rounded-xl px-3 py-2 text-sm ${menu.state === "closed" ? "bg-red-500/15 text-red-600" : "bg-amber-500/15 text-amber-700"}`}>{menu.stateText}</p>
        )}
      </header>

      <nav className="sticky top-0 z-20 flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none]" style={{ background: "var(--bg)" }}>
        {menu.categories.map((c) => (
          <button
            key={c.id}
            className="shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium"
            style={{ background: "var(--sec)" }}
            onClick={() => catRefs.current[c.id]?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            {c.name}
          </button>
        ))}
      </nav>

      <main className="pb-28">
        {menu.categories.map((c) => (
          <section key={c.id} ref={(el) => { catRefs.current[c.id] = el; }} className="scroll-mt-14 px-4 pt-3">
            <h2 className="mb-2 text-base font-semibold">{c.name}</h2>
            <div className="grid grid-cols-2 gap-3">
              {c.products.map((p) => {
                const qty = qtyOfProduct(p);
                const simple = simpleLine(p);
                const min = Math.min(...p.variants.map((v) => v.priceKurus));
                const many = new Set(p.variants.map((v) => v.priceKurus)).size > 1;
                return (
                  <div key={p.key} data-card className="flex h-[236px] flex-col overflow-hidden rounded-2xl" style={{ background: "var(--sec)" }}>
                    <div
                      className="relative h-[110px] w-full shrink-0 cursor-pointer bg-black/5"
                      data-img
                      onClick={() => !closed && (simple ? undefined : setSheet(p))}
                    >
                      {p.image ? <img src={p.image} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-3xl opacity-40">🍽</div>}
                      {qty > 0 && (
                        <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white" style={{ background: FLY_COLOR }}>{qty}</span>
                      )}
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2">
                      <div className="line-clamp-2 text-sm font-medium leading-tight">{p.name}</div>
                      <div className="mt-0.5 line-clamp-1 text-xs opacity-60">{p.description}</div>
                      <div className="mt-auto flex h-9 items-center justify-between gap-2">
                        <span className={`whitespace-nowrap text-sm font-semibold ${simple && qty > 0 ? "opacity-0" : ""}`}>{formatTRY(min).replace(",00 TL", " TL")}{many ? "’den" : ""}</span>
                        {/* Ekle düğmesi ile adet kutusu aynı yer ve boyutu kaplar: kartlar kaymaz */}
                        <div className="relative h-9 w-9 shrink-0">
                          {simple && qty > 0 ? (
                            <div className="absolute right-0 top-0 flex h-9 w-[96px] items-center justify-between rounded-full px-1" style={{ background: "var(--btn)", color: "var(--btn-text)" }}>
                              <button className="h-8 w-8 text-lg leading-none" onClick={() => setQty(simple.id, qty - 1)} aria-label="Azalt">−</button>
                              <span className="text-sm font-semibold">{qty}</span>
                              <button
                                className="h-8 w-8 text-lg leading-none"
                                disabled={closed}
                                onClick={(e) => addLine(simple, 1, (e.currentTarget.closest("[data-card]") as HTMLElement | null)?.querySelector("[data-img]")?.getBoundingClientRect() ?? null)}
                                aria-label="Artır"
                              >+</button>
                            </div>
                          ) : (
                            <button
                              className="flex h-9 w-9 items-center justify-center rounded-full text-xl leading-none disabled:opacity-40"
                              style={{ background: "var(--btn)", color: "var(--btn-text)" }}
                              disabled={closed}
                              aria-label="Ekle"
                              onClick={(e) => {
                                const img = (e.currentTarget.closest("[data-card]") as HTMLElement | null)?.querySelector("[data-img]")?.getBoundingClientRect() ?? null;
                                if (simple) addLine(simple, 1, img);
                                else setSheet(p);
                              }}
                            >+</button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </main>

      {/* Alt sepet çubuğu (uçan dairenin hedefi) */}
      {totalQty > 0 && !cartOpen && !sheet && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-3" style={{ background: "linear-gradient(transparent, var(--bg) 40%)" }}>
          <button
            key={bump}
            className="tg-bump flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left font-semibold shadow-lg"
            style={{ background: "var(--btn)", color: "var(--btn-text)" }}
            onClick={() => setCartOpen(true)}
          >
            <span className="flex items-center gap-3">
              <span ref={cartTarget} className="relative flex h-7 w-7 items-center justify-center text-lg">🛒</span>
              <span>Siparişi gör · {totalQty} ürün</span>
            </span>
            <span>{formatTRY(totalKurus).replace(",00 TL", " TL")}</span>
          </button>
        </div>
      )}

      {sheet && (
        <OptionSheet
          product={sheet}
          menu={menu}
          closed={closed}
          onClose={() => setSheet(null)}
          onAdd={(line, qty, from) => { setSheet(null); setTimeout(() => addLine(line, qty, from), 60); }}
        />
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-40 flex flex-col" style={{ background: "var(--bg)" }}>
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-lg font-bold">Sepetiniz</h2>
            <button className="rounded-full px-3 py-1 text-sm" style={{ background: "var(--sec)" }} onClick={() => setCartOpen(false)}>Kapat</button>
          </div>
          <div className="flex-1 overflow-y-auto px-4">
            {cart.length === 0 && <p className="py-10 text-center text-sm opacity-60">Sepetiniz boş.</p>}
            {cart.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 border-b border-black/10 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{l.name}{l.variantLabel ? ` (${l.variantLabel})` : ""}</div>
                  {l.optionText && <div className="text-xs opacity-60">{l.optionText}</div>}
                  <div className="mt-0.5 text-sm font-semibold">{formatTRY(l.unitKurus * l.qty).replace(",00 TL", " TL")}</div>
                </div>
                <Stepper qty={l.qty} onChange={(q) => setQty(l.id, q)} />
              </div>
            ))}
            <label className="mt-4 block text-sm font-medium">Sipariş notu</label>
            <textarea
              className="mt-1 w-full rounded-xl p-3 text-sm outline-none"
              style={{ background: "var(--sec)" }}
              rows={2}
              maxLength={400}
              placeholder="Örn. acısız olsun"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {menu.discounts.length > 0 && (
              <p className="mt-3 rounded-xl bg-emerald-500/15 px-3 py-2 text-xs text-emerald-700">
                {menu.discounts.map((d) => `${d.name} ile ödemede %${d.percent} indirim`).join(" · ")} (ödeme adımında uygulanır)
              </p>
            )}
            {menu.minBasketKurus > 0 && totalKurus < menu.minBasketKurus && (
              <p className="mt-3 rounded-xl bg-amber-500/15 px-3 py-2 text-xs text-amber-700">Minimum sepet tutarı {formatTRY(menu.minBasketKurus).replace(",00 TL", " TL")}.</p>
            )}
            {error && <p className="mt-3 rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-600">{error}</p>}
            <div className="h-28" />
          </div>
          <div className="p-3" style={{ background: "var(--bg)" }}>
            <button
              className="flex w-full items-center justify-between rounded-2xl px-4 py-3.5 font-semibold disabled:opacity-50"
              style={{ background: "var(--btn)", color: "var(--btn-text)" }}
              disabled={busy || !cart.length || closed}
              onClick={submit}
            >
              <span>{busy ? "Gönderiliyor…" : "Siparişi gönder"}</span>
              <span>{formatTRY(totalKurus).replace(",00 TL", " TL")}</span>
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Stepper({ qty, onChange }: { qty: number; onChange: (q: number) => void }) {
  return (
    <div className="flex h-9 w-[92px] shrink-0 items-center justify-between rounded-full px-1" style={{ background: "var(--sec)" }}>
      <button className="h-8 w-8 text-lg leading-none" onClick={() => onChange(qty - 1)} aria-label="Azalt">−</button>
      <span className="text-sm font-semibold">{qty}</span>
      <button className="h-8 w-8 text-lg leading-none" onClick={() => onChange(qty + 1)} aria-label="Artır">+</button>
    </div>
  );
}

function OptionSheet({
  product, menu, closed, onClose, onAdd,
}: {
  product: Product;
  menu: Menu;
  closed: boolean;
  onClose: () => void;
  onAdd: (line: Omit<Line, "qty">, qty: number, from: DOMRect | null) => void;
}) {
  const [variantId, setVariantId] = useState(product.variants[0].id);
  const [picked, setPicked] = useState<Record<number, number[]>>({});
  const [qty, setQty] = useState(1);
  const addBtn = useRef<HTMLButtonElement | null>(null);

  const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0];
  const groups = variant.groupIds.map((id) => menu.groups[id]).filter(Boolean);

  const toggle = (g: Group, c: Choice) =>
    setPicked((p) => {
      const cur = p[g.id] ?? [];
      if (cur.includes(c.id)) return { ...p, [g.id]: cur.filter((x) => x !== c.id) };
      if (g.maxSelect <= 1) return { ...p, [g.id]: [c.id] };
      if (cur.length >= g.maxSelect) return p;
      return { ...p, [g.id]: [...cur, c.id] };
    });

  const extra = groups.reduce((n, g) => n + (picked[g.id] ?? []).reduce((m, id) => m + (g.choices.find((c) => c.id === id)?.extraKurus ?? 0), 0), 0);
  const missing = groups.find((g) => g.required && !(picked[g.id]?.length));
  const unit = variant.priceKurus + extra;

  const add = () => {
    if (missing || closed) return;
    const options = groups.map((g) => ({ groupId: g.id, choiceIds: picked[g.id] ?? [] })).filter((o) => o.choiceIds.length);
    const optionText = groups
      .flatMap((g) => (picked[g.id] ?? []).map((id) => g.choices.find((c) => c.id === id)?.name))
      .filter(Boolean)
      .join(", ");
    onAdd(
      { id: lineKey(variant.id, options), productKey: product.key, productId: variant.id, name: product.name, variantLabel: variant.label, options, optionText, unitKurus: unit },
      qty,
      addBtn.current?.getBoundingClientRect() ?? null,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50" onClick={onClose}>
      <div className="flex max-h-[88vh] flex-col rounded-t-3xl" style={{ background: "var(--bg)" }} onClick={(e) => e.stopPropagation()}>
        <div className="overflow-y-auto px-4 pb-2 pt-4">
          {product.image && <img src={product.image} alt="" className="mb-3 h-40 w-full rounded-2xl object-cover" />}
          <h3 className="text-lg font-bold">{product.name}</h3>
          {product.description && <p className="mt-1 text-sm opacity-70">{product.description}</p>}

          {product.variants.length > 1 && (
            <div className="mt-4">
              <div className="mb-1.5 text-sm font-semibold">Porsiyon</div>
              <div className="space-y-2">
                {product.variants.map((v) => (
                  <Row key={v.id} checked={v.id === variantId} radio onClick={() => { setVariantId(v.id); setPicked({}); }} label={v.label ?? "Standart"} right={formatTRY(v.priceKurus).replace(",00 TL", " TL")} />
                ))}
              </div>
            </div>
          )}

          {groups.map((g) => (
            <div key={g.id} className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-sm font-semibold">
                <span>{g.name}</span>
                <span className="text-xs font-normal opacity-60">
                  {g.required ? "Zorunlu" : "İsteğe bağlı"}{g.maxSelect > 1 ? ` · en çok ${g.maxSelect}` : ""}
                </span>
              </div>
              <div className="space-y-2">
                {g.choices.map((c) => (
                  <Row
                    key={c.id}
                    checked={(picked[g.id] ?? []).includes(c.id)}
                    radio={g.maxSelect <= 1}
                    onClick={() => toggle(g, c)}
                    label={c.name}
                    right={c.extraKurus > 0 ? `+${formatTRY(c.extraKurus).replace(",00 TL", " TL")}` : ""}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="h-4" />
        </div>
        <div className="flex items-center gap-3 p-3">
          <Stepper qty={qty} onChange={(q) => setQty(Math.max(1, Math.min(MAX_QTY, q)))} />
          <button
            ref={addBtn}
            className="flex-1 rounded-2xl px-4 py-3.5 text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--btn)", color: "var(--btn-text)" }}
            disabled={!!missing || closed}
            onClick={add}
          >
            {missing ? `${missing.name} seçin` : `Sepete ekle · ${formatTRY(unit * qty).replace(",00 TL", " TL")}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ checked, radio, onClick, label, right }: { checked: boolean; radio: boolean; onClick: () => void; label: string; right: string }) {
  return (
    <button className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm" style={{ background: "var(--sec)", outline: checked ? `2px solid ${FLY_COLOR}` : "none" }} onClick={onClick}>
      <span className="flex items-center gap-2.5">
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center border-2 text-[11px] text-white ${radio ? "rounded-full" : "rounded-md"}`}
          style={{ borderColor: checked ? FLY_COLOR : "#9ca3af", background: checked ? FLY_COLOR : "transparent" }}
        >
          {checked ? "✓" : ""}
        </span>
        {label}
      </span>
      <span className="shrink-0 opacity-70">{right}</span>
    </button>
  );
}

/** Telegram tema renklerini (kullanıcının açık/koyu teması) CSS değişkenlerine bağlar */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen"
      style={{
        // @ts-expect-error özel CSS değişkenleri
        "--bg": "var(--tg-theme-bg-color, #ffffff)",
        "--sec": "var(--tg-theme-secondary-bg-color, #f1f5f9)",
        "--btn": "var(--tg-theme-button-color, #195a3b)",
        "--btn-text": "var(--tg-theme-button-text-color, #ffffff)",
        background: "var(--bg)",
        color: "var(--tg-theme-text-color, #0f172a)",
      }}
    >
      <style>{`
        @keyframes tgbump { 0%{transform:scale(1)} 40%{transform:scale(1.04)} 100%{transform:scale(1)} }
        .tg-bump { animation: tgbump .32s ease-out; }
        @media (prefers-reduced-motion: reduce) { .tg-bump { animation: none; } }
        body { background: var(--tg-theme-bg-color, #fff); }
      `}</style>
      {children}
    </div>
  );
}

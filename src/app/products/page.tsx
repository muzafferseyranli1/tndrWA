"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";
import type { MetaStatusDto, ProductDto, SyncSummaryDto } from "@shared/types";

const badge: Record<ProductDto["availability"], { text: string; cls: string }> = {
  IN_STOCK: { text: "Aktif", cls: "bg-green-100 text-green-800" },
  OUT_OF_STOCK: { text: "Bugün tükendi", cls: "bg-amber-100 text-amber-800" },
  HIDDEN: { text: "Pasif", cls: "bg-slate-200 text-slate-600" },
};

const metaBadge: Record<ProductDto["metaSyncState"], { text: string; cls: string }> = {
  PENDING: { text: "Meta: bekliyor", cls: "bg-slate-100 text-slate-600" },
  SYNCED: { text: "Meta: gönderildi", cls: "bg-blue-100 text-blue-800" },
  ERROR: { text: "Meta: hata", cls: "bg-red-100 text-red-700" },
};

const displayName = (p: ProductDto) => (p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name);

/** Kategori içindeki satırlar: tek ürün ya da aynı yemeğin porsiyonları (tek satırda toplanır, tıklayınca açılır). */
type Entry = { kind: "single"; product: ProductDto } | { kind: "group"; key: string; items: ProductDto[] };

function toEntries(items: ProductDto[]): Entry[] {
  const out: Entry[] = [];
  const groups = new Map<string, Extract<Entry, { kind: "group" }>>();
  for (const p of items) {
    if (!p.groupKey) {
      out.push({ kind: "single", product: p });
      continue;
    }
    const g = groups.get(p.groupKey);
    if (g) g.items.push(p);
    else {
      const entry = { kind: "group" as const, key: p.groupKey, items: [p] };
      groups.set(p.groupKey, entry);
      out.push(entry);
    }
  }
  // Tek porsiyonu kalan grup düz satır gibi gösterilir
  return out.map((e): Entry => (e.kind === "group" && e.items.length === 1 ? { kind: "single", product: e.items[0] } : e));
}

/** Porsiyon etiketi boşsa (Excel'den gelen temel porsiyon) "Standart" gösterilir */
const portionLabel = (p: ProductDto) => p.variantLabel?.trim() || "Standart";

const fmtKurus = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProductsPage() {
  const { brand } = useBrands();
  const [meta, setMeta] = useState<MetaStatusDto | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncSummaryDto | null>(null);
  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const brandId = brand?.id;

  const load = useCallback(async () => {
    if (brandId === undefined) return;
    try {
      const [list, status] = await Promise.all([api<ProductDto[]>(`/api/products?brandId=${brandId}`), api<MetaStatusDto>(`/api/meta/status?brandId=${brandId}`)]);
      setProducts(list);
      setMeta(status);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [brandId]);

  useEffect(() => {
    setProducts(null);
    setSyncResult(null);
    void load();
  }, [load]);

  async function act(id: number, run: () => Promise<ProductDto>) {
    setBusyId(id);
    setError("");
    try {
      const updated = await run();
      setProducts((list) => list?.map((p) => (p.id === id ? updated : p)) ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setError("");
    setSyncResult(null);
    try {
      setSyncResult(await api<SyncSummaryDto>("/api/meta/sync", { method: "POST", json: { brandId } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await load();
      setSyncing(false);
    }
  }

  async function move(kind: "products" | "categories", id: number, direction: "up" | "down") {
    setError("");
    try {
      await api(`/api/${kind}/${id}/move`, { method: "POST", json: { direction } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const toggleSoldOut = (p: ProductDto) =>
    act(p.id, () => api<ProductDto>(`/api/products/${p.id}/sold-out`, { method: "POST", json: { soldOut: p.availability !== "OUT_OF_STOCK" } }));
  const toggleStatus = (p: ProductDto) =>
    act(p.id, () => api<ProductDto>(`/api/products/${p.id}`, { method: "PATCH", json: { status: p.status === "ACTIVE" ? "PASSIVE" : "ACTIVE" } }));

  /** Bir yemeğin tüm porsiyonlarını birlikte aktifleştirir ya da pasife alır. */
  async function setGroupStatus(items: ProductDto[], status: "ACTIVE" | "PASSIVE") {
    for (const p of items) if (p.status !== status) await act(p.id, () => api<ProductDto>(`/api/products/${p.id}`, { method: "PATCH", json: { status } }));
  }

  const toggleOpen = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const thumb = (p: ProductDto) =>
    p.imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={p.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-cover" />
    ) : (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 text-[10px] text-slate-400">Görsel yok</div>
    );

  const badges = (p: ProductDto) => (
    <>
      <span className={`rounded-full px-2 py-0.5 text-xs ${badge[p.availability].cls}`}>{badge[p.availability].text}</span>
      {p.metaSyncState === "SYNCED" && !p.onMeta ? (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Meta: katalogda yok</span>
      ) : (
        <span title={p.metaError ?? ""} className={`rounded-full px-2 py-0.5 text-xs ${metaBadge[p.metaSyncState].cls}`}>{metaBadge[p.metaSyncState].text}</span>
      )}
    </>
  );

  const actions = (p: ProductDto, withEdit = true) => (
    <div className="flex flex-wrap gap-2">
      {p.status === "ACTIVE" && (
        <button disabled={busyId === p.id} onClick={() => toggleSoldOut(p)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
          {p.availability === "OUT_OF_STOCK" ? "Tekrar aç" : "Bugün tükendi"}
        </button>
      )}
      <button disabled={busyId === p.id} onClick={() => toggleStatus(p)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
        {p.status === "ACTIVE" ? "Pasife al" : "Aktifleştir"}
      </button>
      {withEdit && (
        <Link href={`/products/${p.id}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
          Düzenle
        </Link>
      )}
    </div>
  );

  const arrows = (id: number, i: number, total: number) =>
    !query.trim() && (
      <div className="flex flex-col gap-1">
        <button title="Yukarı al" disabled={i === 0} onClick={() => move("products", id, "up")} className="rounded border border-slate-300 px-1.5 text-[10px] leading-4 hover:bg-slate-50 disabled:opacity-30">▲</button>
        <button title="Aşağı al" disabled={i === total - 1} onClick={() => move("products", id, "down")} className="rounded border border-slate-300 px-1.5 text-[10px] leading-4 hover:bg-slate-50 disabled:opacity-30">▼</button>
      </div>
    );

  const groups = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    const map = new Map<string, ProductDto[]>();
    for (const p of products ?? []) {
      if (q && !displayName(p).toLocaleLowerCase("tr").includes(q) && !p.categoryName.toLocaleLowerCase("tr").includes(q)) continue;
      map.set(p.categoryName, [...(map.get(p.categoryName) ?? []), p]);
    }
    return [...map.entries()];
  }, [products, query]);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Ürünler{brand ? ` · ${brand.name}` : ""}</h1>
          <Link href="/products/new" className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">
            Yeni ürün
          </Link>
        </div>

        {meta && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            <span className="text-slate-700">
              Meta kataloğu: <b>{meta.counts.pending}</b> bekliyor · <b>{meta.counts.synced}</b> gönderildi · <b className={meta.counts.error ? "text-red-600" : ""}>{meta.counts.error}</b> hata
              {meta.autoSync ? " · otomatik gönderim açık" : ""}
            </span>
            <button
              onClick={syncNow}
              disabled={syncing || meta.blockers.length > 0}
              className="ml-auto rounded-lg bg-brand-500 px-3 py-1.5 font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {syncing ? "Gönderiliyor…" : "Meta'ya gönder"}
            </button>
            {meta.blockers.length > 0 && <p className="basis-full text-xs text-amber-700">Gönderim kapalı: {meta.blockers.join("; ")}.</p>}
          </div>
        )}
        {syncResult && (
          <p className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
            Gönderim bitti: {syncResult.synced} başarılı, {syncResult.failed} hatalı, {syncResult.skipped} atlandı.
          </p>
        )}
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ürün veya kategori ara…"
          className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-brand-500"
        />
        {!products && !error && <p className="text-slate-500">Yükleniyor…</p>}
        {products && products.length === 0 && <p className="text-slate-500">Bu markada henüz ürün yok.</p>}

        <div className="space-y-6">
          {groups.map(([category, items], gi) => (
            <section key={category}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                {category} <span className="font-normal normal-case text-slate-400">({items.length})</span>
                {!query.trim() && (
                  <span className="ml-auto flex gap-1 normal-case">
                    <button title="Kategoriyi yukarı al" disabled={gi === 0} onClick={() => move("categories", items[0].categoryId, "up")} className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-30">▲</button>
                    <button title="Kategoriyi aşağı al" disabled={gi === groups.length - 1} onClick={() => move("categories", items[0].categoryId, "down")} className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-30">▼</button>
                  </span>
                )}
              </h2>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {toEntries(items).map((e, i, all) => {
                  if (e.kind === "single") {
                    const p = e.product;
                    return (
                      <li key={p.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${p.availability === "HIDDEN" ? "opacity-60" : ""}`}>
                        {arrows(p.id, i, all.length)}
                        {thumb(p)}
                        <div className="min-w-0 flex-1 basis-60">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{displayName(p)}</span>
                            {badges(p)}
                          </div>
                          {p.metaError && <p className="text-xs text-red-600">{p.metaError}</p>}
                          <p className="truncate text-sm text-slate-500">{p.description || "Açıklama yok"}</p>
                        </div>
                        <span className="w-28 text-right font-medium tabular-nums">{p.priceText}</span>
                        {actions(p)}
                      </li>
                    );
                  }
                  const first = e.items[0];
                  const min = Math.min(...e.items.map((x) => x.priceKurus));
                  const max = Math.max(...e.items.map((x) => x.priceKurus));
                  const active = e.items.filter((x) => x.status === "ACTIVE").length;
                  const expanded = open.has(e.key) || !!query.trim();
                  return (
                    <li key={e.key} className={active === 0 ? "opacity-60" : ""}>
                      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                        {arrows(first.id, i, all.length)}
                        {thumb(first)}
                        <div className="min-w-0 flex-1 basis-60">
                          <div className="flex flex-wrap items-center gap-2">
                            <button onClick={() => toggleOpen(e.key)} className="text-left font-medium hover:text-brand-600" aria-expanded={expanded}>
                              {expanded ? "▾" : "▸"} {first.name}
                            </button>
                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800">{e.items.length} porsiyon</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs ${active === 0 ? "bg-slate-200 text-slate-600" : active === e.items.length ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                              {active === 0 ? "Pasif" : active === e.items.length ? "Aktif" : `${active}/${e.items.length} aktif`}
                            </span>
                          </div>
                          <p className="truncate text-sm text-slate-500">{e.items.map(portionLabel).join(" · ")}</p>
                        </div>
                        <span className="whitespace-nowrap text-right font-medium tabular-nums sm:w-44">{min === max ? first.priceText : `${fmtKurus(min)}–${fmtKurus(max)} TL`}</span>
                        <div className="flex flex-wrap gap-2">
                          <button disabled={busyId !== null} onClick={() => void setGroupStatus(e.items, active === e.items.length ? "PASSIVE" : "ACTIVE")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
                            {active === e.items.length ? "Hepsini pasife al" : "Hepsini aktifleştir"}
                          </button>
                          <Link href={`/products/${first.id}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                            Düzenle
                          </Link>
                        </div>
                      </div>
                      {expanded && (
                        <ul className="border-t border-slate-100 bg-slate-50/60">
                          {e.items.map((p) => (
                            <li key={p.id} className={`flex flex-wrap items-center gap-3 py-2 pl-16 pr-4 ${p.availability === "HIDDEN" ? "opacity-60" : ""}`}>
                              <div className="min-w-0 flex-1 basis-48">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium">{portionLabel(p)}</span>
                                  {badges(p)}
                                </div>
                                {p.metaError && <p className="text-xs text-red-600">{p.metaError}</p>}
                              </div>
                              <span className="w-28 text-right text-sm font-medium tabular-nums">{p.priceText}</span>
                              {actions(p, false)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}

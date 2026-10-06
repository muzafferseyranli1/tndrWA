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

export default function ProductsPage() {
  const { brand } = useBrands();
  const [meta, setMeta] = useState<MetaStatusDto | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncSummaryDto | null>(null);
  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

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

  const toggleSoldOut = (p: ProductDto) =>
    act(p.id, () => api<ProductDto>(`/api/products/${p.id}/sold-out`, { method: "POST", json: { soldOut: p.availability !== "OUT_OF_STOCK" } }));
  const toggleStatus = (p: ProductDto) =>
    act(p.id, () => api<ProductDto>(`/api/products/${p.id}`, { method: "PATCH", json: { status: p.status === "ACTIVE" ? "PASSIVE" : "ACTIVE" } }));

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
              disabled={syncing || meta.blockers.length > 0 || meta.counts.pending + meta.counts.error === 0}
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
          {groups.map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                {category} <span className="font-normal normal-case text-slate-400">({items.length})</span>
              </h2>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {items.map((p) => (
                  <li key={p.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${p.availability === "HIDDEN" ? "opacity-60" : ""}`}>
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 text-[10px] text-slate-400">Görsel yok</div>
                    )}
                    <div className="min-w-0 flex-1 basis-60">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{displayName(p)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${badge[p.availability].cls}`}>{badge[p.availability].text}</span>
                        {p.metaSyncState === "SYNCED" && !p.onMeta ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Meta: katalogda yok</span>
                        ) : (
                          <span title={p.metaError ?? ""} className={`rounded-full px-2 py-0.5 text-xs ${metaBadge[p.metaSyncState].cls}`}>{metaBadge[p.metaSyncState].text}</span>
                        )}
                      </div>
                      {p.metaError && <p className="text-xs text-red-600">{p.metaError}</p>}
                      <p className="truncate text-sm text-slate-500">{p.description || "Açıklama yok"}</p>
                    </div>
                    <span className="w-28 text-right font-medium tabular-nums">{p.priceText}</span>
                    <div className="flex flex-wrap gap-2">
                      {p.status === "ACTIVE" && (
                        <button disabled={busyId === p.id} onClick={() => toggleSoldOut(p)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
                          {p.availability === "OUT_OF_STOCK" ? "Tekrar aç" : "Bugün tükendi"}
                        </button>
                      )}
                      <button disabled={busyId === p.id} onClick={() => toggleStatus(p)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
                        {p.status === "ACTIVE" ? "Pasife al" : "Aktifleştir"}
                      </button>
                      <Link href={`/products/${p.id}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                        Düzenle
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}

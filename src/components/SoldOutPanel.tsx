"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ProductDto } from "@shared/types";

const label = (p: ProductDto) => (p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name);
const until = (iso: string | null) => (iso ? new Date(iso).toLocaleString("tr-TR", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "");
const norm = (s: string) => s.toLocaleLowerCase("tr-TR");

/**
 * Mutfak/kasa için tükendi listesi: yalnız aktif ürünleri "bugün tükendi" yapar ya da geri açar (fiyat ve diğer ayarlar yok).
 * İşaret hemen WhatsApp kataloğuna gider; sabah sıfırlama saatinde kendiliğinden kalkar.
 */
export default function SoldOutPanel({ brandId, brandName, catalogLinked, onClose }: { brandId: number; brandName: string; catalogLinked: boolean; onClose: () => void }) {
  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setProducts(await api<ProductDto[]>(`/api/products?brandId=${brandId}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [brandId]);

  // Katalog gönderimi birkaç saniye sürer: durum yazısı güncellensin diye pencere açıkken tazelenir
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function toggle(p: ProductDto) {
    const soldOut = p.availability !== "OUT_OF_STOCK";
    setBusyId(p.id);
    setError("");
    try {
      const updated = await api<ProductDto>(`/api/products/${p.id}/sold-out`, { method: "POST", json: { soldOut } });
      setProducts((list) => list?.map((x) => (x.id === updated.id ? updated : x)) ?? null);
      setTouched((s) => new Set(s).add(p.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const active = (products ?? []).filter((p) => p.status === "ACTIVE");
  const q = norm(query.trim());
  const matches = q ? active.filter((p) => norm(label(p)).includes(q) || norm(p.categoryName).includes(q)) : active;
  const soldOut = matches.filter((p) => p.availability === "OUT_OF_STOCK");
  const onSale = matches.filter((p) => p.availability !== "OUT_OF_STOCK");
  const categories = [...new Set(onSale.map((p) => p.categoryName))];

  function syncNote(p: ProductDto) {
    if (!catalogLinked || !(touched.has(p.id) || p.availability === "OUT_OF_STOCK")) return null;
    if (p.metaSyncState === "ERROR") return <span className="block text-xs text-red-600">WhatsApp kataloğuna gitmedi{p.metaError ? `: ${p.metaError}` : ""}</span>;
    if (p.metaSyncState === "PENDING") return <span className="block text-xs text-slate-500">WhatsApp kataloğuna gönderiliyor…</span>;
    return <span className="block text-xs text-green-700">✓ WhatsApp kataloğunda güncel</span>;
  }

  const row = (p: ProductDto) => {
    const out = p.availability === "OUT_OF_STOCK";
    return (
      <li key={p.id} className="flex items-center gap-3 py-2">
        <span className="min-w-0 flex-1">
          <span className={out ? "font-medium text-red-700" : ""}>{label(p)}</span>
          {out && p.soldOutUntil && <span className="block text-xs text-slate-500">{until(p.soldOutUntil)} kendiliğinden geri açılır</span>}
          {syncNote(p)}
        </span>
        <button
          disabled={busyId === p.id}
          onClick={() => void toggle(p)}
          className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 ${out ? "bg-brand-500 text-white hover:bg-brand-600" : "border border-red-300 text-red-700 hover:bg-red-50"}`}
        >
          {out ? "Geri aç" : "Tükendi"}
        </button>
      </li>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Tükendi listesi" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold">Tükendi listesi · {brandName}</h2>
          <button onClick={onClose} className="ml-auto rounded-lg border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">
            Kapat
          </button>
        </div>
        <div className="space-y-2 border-b border-slate-100 px-4 py-3">
          <p className="text-sm text-slate-600">
            Biten ürüne &quot;Tükendi&quot; deyin: WhatsApp kataloğunda <b>stokta yok</b> görünür, müşteri sepete ekleyemez. Ertesi sabah kendiliğinden geri açılır.
          </p>
          {!catalogLinked && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Bu markanın WhatsApp kataloğu henüz bağlı değil; işaret şimdilik yalnız panelde geçerli.</p>}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ürün ara…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500" />
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
        <div className="overflow-y-auto px-4 pb-4">
          {!products && !error && <p className="py-4 text-sm text-slate-500">Yükleniyor…</p>}
          {products && matches.length === 0 && <p className="py-4 text-sm text-slate-500">{q ? "Aramaya uyan ürün yok." : "Bu markada aktif ürün yok."}</p>}
          {soldOut.length > 0 && (
            <>
              <h3 className="mt-3 text-sm font-semibold text-red-700">Tükenenler ({soldOut.length})</h3>
              <ul className="divide-y divide-slate-100 text-sm">{soldOut.map(row)}</ul>
            </>
          )}
          {categories.map((c) => (
            <div key={c}>
              <h3 className="mt-3 text-sm font-semibold text-slate-500">{c}</h3>
              <ul className="divide-y divide-slate-100 text-sm">{onSale.filter((p) => p.categoryName === c).map(row)}</ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

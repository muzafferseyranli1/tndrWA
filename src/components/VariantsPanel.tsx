"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatTRY, portionPrice } from "@shared/money";
import type { ProductDto } from "@shared/types";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500";

/** Aynı yemeğin porsiyonları (her birinin kendi fiyatı var; katalogda ayrı ürün olarak görünür). */
export default function VariantsPanel({ product }: { product: ProductDto }) {
  const [siblings, setSiblings] = useState<ProductDto[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [price, setPrice] = useState("");

  const load = useCallback(async () => {
    try {
      const all = await api<ProductDto[]>(`/api/products?brandId=${product.brandId}`);
      setSiblings(product.groupKey ? all.filter((p) => p.groupKey === product.groupKey) : [product]);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [product]);

  useEffect(() => {
    void load();
  }, [load]);

  // Çarpan ve açık fiyat, "1 Porsiyon" kaydını (yoksa bu ürünü) temel alır
  const base = siblings.find((s) => s.variantLabel === "1 Porsiyon") ?? (product.groupKey ? siblings[0] : product);
  const has15 = siblings.some((s) => s.variantLabel === "1,5 Porsiyon");

  async function add(body: Record<string, unknown>) {
    if (!base) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/products/${base.id}/variants`, { method: "POST", json: body });
      setLabel("");
      setPrice("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 max-w-xl space-y-3 border-t border-slate-200 pt-6">
      <h2 className="text-lg font-semibold">Porsiyonlar</h2>
      <p className="text-sm text-slate-500">Her porsiyonun kendi fiyatı vardır ve katalogda ayrı ürün olarak görünür (müşteri fiyatı baştan görür).</p>

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
        {siblings.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2">
            <span className={s.id === product.id ? "font-semibold" : ""}>{s.variantLabel ?? "Tek porsiyon"}</span>
            <span className="tabular-nums">{s.priceText}</span>
            {s.id === product.id ? <span className="w-16 text-right text-xs text-slate-400">açık</span> : <Link href={`/products/${s.id}`} className="w-16 text-right text-brand-600 hover:underline">Düzenle</Link>}
          </li>
        ))}
      </ul>

      {base && !has15 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => add({ label: "1,5 Porsiyon", factor: 1.5, baseLabel: "1 Porsiyon" })}
          className="rounded-lg border border-brand-500 px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50"
        >
          1,5 porsiyon ekle (×1,5 = {formatTRY(portionPrice(base.priceKurus, 1.5))})
        </button>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="mb-2 text-sm font-medium">Başka porsiyon ekle</p>
        <div className="flex flex-wrap gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ad (örn. 500 gr, 4 Kişi)" maxLength={40} className={`${input} basis-48 flex-1`} />
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Fiyat (TL)" inputMode="decimal" className={`${input} basis-32`} />
          <button type="button" disabled={busy || !label.trim() || !price.trim()} onClick={() => add({ label, price, baseLabel: "1 Porsiyon" })} className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
            Ekle
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

"use client";

import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";
import type { BrandDto } from "@shared/types";

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500";

function BrandCard({ brand, onSaved }: { brand: BrandDto; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/brands/${brand.id}`, {
        method: "PATCH",
        json: { name: form.get("name"), metaCatalogId: form.get("metaCatalogId"), waSession: form.get("waSession") },
      });
      setMessage({ ok: true, text: "Kaydedildi." });
      onSaved();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{brand.name}</h2>
        <span className="text-xs text-slate-500">kod: {brand.code} · {brand.productCount} ürün kaydı</span>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-slate-600">Marka adı</span>
        <input name="name" required defaultValue={brand.name} className={field} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-slate-600">Meta katalog kimliği</span>
        <input name="metaCatalogId" inputMode="numeric" defaultValue={brand.metaCatalogId ?? ""} placeholder="Henüz girilmedi" className={field} />
        <span className="mt-1 block text-xs text-slate-500">
          Commerce Manager&apos;daki katalog kimliği (yalnızca rakam). Boş bırakılırsa bu marka için Meta&apos;ya gönderim kapalı kalır. Değiştirirseniz markanın tüm ürünleri yeniden gönderilmek üzere işaretlenir.
        </span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-slate-600">WhatsApp (WAHA) oturum adı</span>
        <input name="waSession" defaultValue={brand.waSession ?? ""} placeholder="Henüz girilmedi (örn. tandir)" className={field} />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-600 disabled:opacity-60">
          {busy ? "Kaydediliyor…" : "Kaydet"}
        </button>
        {message && <span className={`text-sm ${message.ok ? "text-green-700" : "text-red-600"}`}>{message.text}</span>}
      </div>
    </form>
  );
}

export default function BrandsPage() {
  const { brands, reload } = useBrands();

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-semibold">Markalar</h1>
        <p className="mb-4 text-sm text-slate-500">Her markanın kendi menüsü, Meta kataloğu ve WhatsApp numarası vardır.</p>
        {!brands && <p className="text-slate-500">Yükleniyor…</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {brands?.map((b) => (
            <BrandCard key={`${b.id}-${b.metaCatalogId}-${b.name}-${b.waSession}`} brand={b} onSaved={() => void reload()} />
          ))}
        </div>
      </main>
    </>
  );
}

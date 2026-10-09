"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";
import type { HoursConfig } from "@shared/hours";

interface HoursView {
  hours: HoursConfig;
  open: boolean;
  state: "open" | "pre" | "closed";
  minBasketKurus: number;
  nextOpening: string;
  summary: string;
}

const field = "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500";

export default function HoursPage() {
  const { brand } = useBrands();
  const brandId = brand?.id;
  const [view, setView] = useState<HoursView | null>(null);
  const [form, setForm] = useState<HoursConfig | null>(null);
  const [minTl, setMinTl] = useState("0");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (brandId === undefined) return;
    try {
      const v = await api<HoursView>(`/api/hours?brandId=${brandId}`);
      setView(v);
      setForm(v.hours);
      setMinTl(String(v.minBasketKurus / 100));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, [brandId]);

  useEffect(() => {
    setView(null);
    void load();
  }, [load]);

  async function save() {
    if (!form) return;
    setBusy(true);
    setMsg(null);
    try {
      const v = await api<HoursView>("/api/hours", { method: "PUT", json: { brandId, hours: form, minBasketKurus: Math.round(Number(minTl.replace(",", ".")) * 100) || 0 } });
      setView(v);
      setForm(v.hours);
      setMinTl(String(v.minBasketKurus / 100));
      setMsg({ ok: true, text: "Kaydedildi." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, k: "weekday" | "weekend") =>
    form && (
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-28 text-sm font-medium">{label}</span>
        <input type="time" value={form[k].open} onChange={(e) => setForm({ ...form, [k]: { ...form[k], open: e.target.value } })} className={field} aria-label={`${label} açılış`} />
        <span className="text-slate-500">–</span>
        <input type="time" value={form[k].close} onChange={(e) => setForm({ ...form, [k]: { ...form[k], close: e.target.value } })} className={field} aria-label={`${label} kapanış`} />
      </div>
    );

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold">Saatler ve minimum sepet{brand ? ` · ${brand.name}` : ""}</h1>
        {!form && !msg && <p className="text-slate-500">Yükleniyor…</p>}
        {view && (
          <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${!view.hours.enabled ? "bg-slate-100 text-slate-700" : view.state !== "closed" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}>
            {!view.hours.enabled ? "Saat kontrolü kapalı: her zaman sipariş alınır." : view.state === "open" ? "Şu an AÇIK, sipariş alınıyor." : view.state === "pre" ? `Henüz açılmadık ama açılışa 1 saatten az var: sipariş alınıyor, açılışta (${view.nextOpening}) hazırlanır.` : `Şu an KAPALI, sipariş alınmıyor. Bir sonraki açılış: ${view.nextOpening}. Siparişler açılıştan 1 saat önce başlar.`}
          </p>
        )}
        {form && (
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
              Saat dışında sipariş alma (müşteriye kapalı mesajı gider)
            </label>
            {row("Hafta içi", "weekday")}
            {row("Hafta sonu", "weekend")}
            <p className="text-xs text-slate-500">Siparişler açılıştan 1 saat önce başlar; o saatlerde verilen sipariş kabul edilir ve açılışta hazırlanır. Daha erken gelen sepetlere kapalı mesajı gider.</p>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Minimum sepet tutarı (TL, 0 = sınır yok)</span>
              <input value={minTl} onChange={(e) => setMinTl(e.target.value)} inputMode="decimal" className={`${field} w-40`} />
              <span className="mt-1 block text-xs text-slate-500">Sepet bu tutarın altındaysa sipariş açılmaz; müşteriye ne kadar daha ürün ekleyeceği söylenir. Teslimat ücreti yoktur.</span>
            </label>
            <p className="text-xs text-slate-500">Hafta sonu = Cumartesi ve Pazar. Saatler İstanbul saatidir. Kapanış açılıştan küçükse gece yarısını geçen vardiya sayılır (örn. 18:00–02:00). Kapalı mesajının metnini Mesajlar sayfasından değiştirebilirsiniz.</p>
            <button disabled={busy} onClick={save} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
              Kaydet
            </button>
            {msg && <p role="alert" className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
          </section>
        )}
      </main>
    </>
  );
}

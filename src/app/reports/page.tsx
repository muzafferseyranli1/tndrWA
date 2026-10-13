"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";
import { formatTRY } from "@shared/money";
import { addDays, istanbulParts, type ReportData } from "@shared/reports";

type Report = ReportData & { from: string; to: string };

const field = "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500";
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", weekday: "short", timeZone: "UTC" });

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function Bars({ items, format }: { items: { label: string; value: number }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-slate-600">{i.label}</span>
          <span className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
            <span className="block h-full rounded bg-brand-500" style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
          <span className="w-28 shrink-0 text-right tabular-nums">{format(i.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ReportsPage() {
  const { brand } = useBrands();
  const brandId = brand?.id;
  const today = istanbulParts(new Date()).date;
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (brandId === undefined) return;
    setError("");
    try {
      setData(await api<Report>(`/api/reports?brandId=${brandId}&from=${from}&to=${to}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [brandId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const month = `${today.slice(0, 8)}01`;
  const s = data?.summary;
  const hours = data ? data.hourly.map((n, h) => ({ label: `${String(h).padStart(2, "0")}:00`, value: n })).filter((h, i) => h.value > 0 || (i >= 9 && i <= 23)) : [];
  const presets: [string, string, string][] = [
    ["Bugün", today, today],
    ["Dün", addDays(today, -1), addDays(today, -1)],
    ["Son 7 gün", addDays(today, -6), today],
    ["Son 30 gün", addDays(today, -29), today],
    ["Bu ay", month, today],
  ];

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold">Raporlar{brand ? ` · ${brand.name}` : ""}</h1>

        <div className="mb-5 flex flex-wrap items-end gap-2">
          {presets.map(([label, a, b]) => (
            <button
              key={label}
              onClick={() => {
                setFrom(a);
                setTo(b);
              }}
              className={`rounded-lg border px-3 py-2 text-sm ${from === a && to === b ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300 bg-white hover:bg-slate-50"}`}
            >
              {label}
            </button>
          ))}
          <label className="text-sm">
            <span className="mb-1 block text-xs text-slate-500">Başlangıç</span>
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={field} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-slate-500">Bitiş</span>
            <input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className={field} />
          </label>
        </div>

        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {!data && !error && <p className="text-slate-500">Yükleniyor…</p>}

        {s && data && (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Tile label="Ciro (indirim düşülmüş)" value={formatTRY(s.revenueKurus)} hint={s.discountKurus ? `${formatTRY(s.discountKurus)} indirim verildi` : undefined} />
              <Tile label="Sipariş" value={String(s.orders)} hint={s.incomplete ? `${s.incomplete} sepet tamamlanmadı` : undefined} />
              <Tile label="Ortalama sepet" value={formatTRY(s.avgBasketKurus)} />
              <Tile label="İptal" value={String(s.cancelled)} />
              <Tile label="Müşteri" value={String(s.customers)} hint={`${s.newCustomers} yeni`} />
            </div>

            <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 font-medium">Günlük ciro</h2>
              <Bars items={data.daily.map((d) => ({ label: dayLabel(d.date), value: d.revenueKurus }))} format={(n) => formatTRY(n)} />
              <p className="mt-2 text-xs text-slate-500">Günlük sipariş sayıları: {data.daily.map((d) => `${dayLabel(d.date)}: ${d.orders}`).join(" · ")}</p>
            </section>

            <div className="mb-6 grid gap-6 md:grid-cols-2">
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="mb-3 font-medium">Saate göre sipariş</h2>
                <Bars items={hours} format={(n) => `${n} sipariş`} />
              </section>
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="mb-3 font-medium">Ödeme şekli</h2>
                {data.payments.length === 0 && <p className="text-sm text-slate-500">Veri yok.</p>}
                <table className="w-full text-sm">
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.label} className="border-b border-slate-100 last:border-0">
                        <td className="py-1.5">{p.label}</td>
                        <td className="py-1.5 text-right tabular-nums">{p.orders} sipariş</td>
                        <td className="py-1.5 text-right tabular-nums">{formatTRY(p.revenueKurus)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 font-medium">En çok satan ürünler</h2>
              {data.products.length === 0 && <p className="text-sm text-slate-500">Veri yok.</p>}
              <table className="w-full text-sm">
                <tbody>
                  {data.products.map((p, i) => (
                    <tr key={p.name} className="border-b border-slate-100 last:border-0">
                      <td className="w-8 py-1.5 text-slate-400">{i + 1}</td>
                      <td className="py-1.5">{p.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{p.quantity} adet</td>
                      <td className="py-1.5 text-right tabular-nums">{formatTRY(p.revenueKurus)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">Ürün tutarları liste fiyatıyladır (indirim öncesi). İptal edilen ve müşterinin tamamlamadığı sepetler hesaba katılmaz.</p>
            </section>
          </>
        )}
      </main>
    </>
  );
}

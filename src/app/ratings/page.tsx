"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";
import type { RatingDto, RatingSummaryDto } from "@shared/types";

type Filter = "pending" | "low" | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "pending", label: "Aranacaklar" },
  { key: "low", label: "Tüm düşük puanlılar" },
  { key: "all", label: "Hepsi" },
];

const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
const when = (iso: string) => new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const FOLLOW: Record<RatingDto["followUp"], { text: string; cls: string }> = {
  NONE: { text: "", cls: "" },
  PENDING: { text: "Aranacak", cls: "bg-red-100 text-red-700" },
  CALLED: { text: "Arandı", cls: "bg-amber-100 text-amber-800" },
  RESOLVED: { text: "Çözüldü", cls: "bg-green-100 text-green-800" },
};

function Item({ r, onChanged }: { r: RatingDto; onChanged: () => void }) {
  const [note, setNote] = useState(r.followNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function set(followUp: "PENDING" | "CALLED" | "RESOLVED") {
    setBusy(true);
    setError("");
    try {
      await api(`/api/ratings/${r.id}`, { method: "PATCH", json: { followUp, followNote: note } });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`rounded-xl border bg-white p-4 ${r.low ? "border-red-200" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">{r.name ?? "İsimsiz"}</span>
        {r.phone && (
          <a href={`tel:+${r.phone}`} className="text-sm text-brand-600 underline">
            +{r.phone} ara
          </a>
        )}
        {!r.phone && r.low && <span className="text-sm text-slate-500">telefon yok</span>}
        {r.orderId && <span className="text-xs text-slate-500">Sipariş #{r.orderId}</span>}
        {FOLLOW[r.followUp].text && <span className={`rounded-full px-2 py-0.5 text-xs ${FOLLOW[r.followUp].cls}`}>{FOLLOW[r.followUp].text}</span>}
        <span className="ml-auto text-xs text-slate-500">{when(r.createdAt)}</span>
      </div>
      <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-3">
        {([["Lezzet", r.taste], ["Hizmet", r.care], ["Servis", r.delivery]] as const).map(([label, n]) => (
          <div key={label} className="flex items-center gap-2">
            <dt className="w-14 text-slate-500">{label}</dt>
            <dd className={n < 4 ? "font-semibold text-red-600" : "text-amber-500"}>{stars(n)}</dd>
          </div>
        ))}
      </dl>
      {r.comment && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm">{r.comment}</p>}
      {r.low && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Görüşme notu" className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button disabled={busy} onClick={() => set("CALLED")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">Arandı</button>
          <button disabled={busy} onClick={() => set("RESOLVED")} className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">Çözüldü</button>
          {r.followUp !== "PENDING" && (
            <button disabled={busy} onClick={() => set("PENDING")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">Yeniden aranacak</button>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </li>
  );
}

export default function RatingsPage() {
  const { brand } = useBrands();
  const brandId = brand?.id;
  const [filter, setFilter] = useState<Filter>("pending");
  const [items, setItems] = useState<RatingDto[] | null>(null);
  const [summary, setSummary] = useState<RatingSummaryDto | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (brandId === undefined) return;
    try {
      const [list, sum] = await Promise.all([api<RatingDto[]>(`/api/ratings?brandId=${brandId}&filter=${filter}`), api<RatingSummaryDto>(`/api/ratings/summary?brandId=${brandId}&days=30`)]);
      setItems(list);
      setSummary(sum);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [brandId, filter]);

  useEffect(() => {
    setItems(null);
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const n = summary?.pendingCount ?? 0;
    document.title = n > 0 ? `(${n}) Aranacak · tndrWA` : "Değerlendirmeler · tndrWA";
  }, [summary]);

  const fmt = (n: number | null) => (n === null ? "-" : n.toFixed(1));

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold">Değerlendirmeler{brand ? ` · ${brand.name}` : ""}</h1>
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {summary && (
          <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Son 30 gün", `${summary.count} değerlendirme`],
              ["Lezzet", fmt(summary.avgTaste)],
              ["Hizmet", fmt(summary.avgCare)],
              ["Servis", fmt(summary.avgDelivery)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">{k}</div>
                <div className="text-lg font-semibold tabular-nums">{v}</div>
              </div>
            ))}
            <div className="col-span-2 rounded-xl border border-red-200 bg-white p-3 sm:col-span-4">
              <span className="font-medium text-red-700">{summary.pendingCount}</span> kişi aranmayı bekliyor · son 30 günde {summary.lowCount} düşük puan (herhangi bir soru 4&apos;ün altında)
            </div>
          </section>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-lg px-4 py-2 text-sm font-medium ${filter === f.key ? "bg-brand-500 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
              {f.label}
            </button>
          ))}
        </div>

        {!items && !error && <p className="text-slate-500">Yükleniyor…</p>}
        {items && items.length === 0 && <p className="text-slate-500">{filter === "pending" ? "Aranacak kimse yok." : "Henüz değerlendirme yok."}</p>}
        <ul className="space-y-3">{items?.map((r) => <Item key={`${r.id}-${r.followUp}-${r.followNote}`} r={r} onChanged={() => void load()} />)}</ul>

      </main>
    </>
  );
}

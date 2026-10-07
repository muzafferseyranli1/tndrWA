"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";
import type { OrderDto, OrderStatusDto, OrderStatusResultDto } from "@shared/types";

const label: Record<OrderStatusDto, { text: string; cls: string }> = {
  NEW: { text: "Yeni", cls: "bg-red-100 text-red-700" },
  PREPARING: { text: "Hazırlanıyor", cls: "bg-amber-100 text-amber-800" },
  ON_THE_WAY: { text: "Yolda", cls: "bg-blue-100 text-blue-800" },
  DELIVERED: { text: "Teslim edildi", cls: "bg-green-100 text-green-800" },
  CANCELLED: { text: "İptal", cls: "bg-slate-200 text-slate-600" },
};

const next: Partial<Record<OrderStatusDto, { to: OrderStatusDto; text: string }>> = {
  NEW: { to: "PREPARING", text: "Hazırlanıyor" },
  PREPARING: { to: "ON_THE_WAY", text: "Yola çıktı" },
  ON_THE_WAY: { to: "DELIVERED", text: "Teslim edildi" },
};

const POLL_MS = 4000;
const ALARM_MS = 7000;

const time = (iso: string) => new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function OrdersPage() {
  const { brand } = useBrands();
  const brandId = brand?.id;
  const [tab, setTab] = useState<"active" | "history">("active");
  const [orders, setOrders] = useState<OrderDto[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notices, setNotices] = useState<Record<number, string>>({});
  const [soundOn, setSoundOn] = useState(false);
  const audio = useRef<AudioContext | null>(null);

  const load = useCallback(async () => {
    if (brandId === undefined) return;
    try {
      setOrders(await api<OrderDto[]>(`/api/orders?brandId=${brandId}&scope=${tab}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [brandId, tab]);

  useEffect(() => {
    setOrders(null);
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const newCount = tab === "active" ? (orders ?? []).filter((o) => o.status === "NEW").length : 0;

  const beep = useCallback(() => {
    const ctx = audio.current;
    if (!ctx) return;
    const now = ctx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.25);
      gain.gain.exponentialRampToValueAtTime(0.4, now + i * 0.25 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.25 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.25);
      osc.stop(now + i * 0.25 + 0.25);
    });
  }, []);

  // Yeni (henüz işlenmemiş) sipariş varken ses tekrar tekrar çalar; sipariş işleme alınınca durur
  useEffect(() => {
    if (!soundOn || newCount === 0) return;
    beep();
    const t = setInterval(beep, ALARM_MS);
    return () => clearInterval(t);
  }, [soundOn, newCount, beep]);

  useEffect(() => {
    document.title = newCount > 0 ? `(${newCount}) Yeni sipariş · tndrWA` : "Siparişler · tndrWA";
  }, [newCount]);

  function enableSound() {
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume();
      setSoundOn(true);
      beep();
    } catch {
      setError("Tarayıcı ses çalmaya izin vermedi.");
    }
  }

  async function setStatus(order: OrderDto, status: OrderStatusDto) {
    if (status === "CANCELLED" && !window.confirm(`#${order.id} numaralı sipariş iptal edilsin ve müşteriye bildirilsin mi?`)) return;
    setBusyId(order.id);
    setError("");
    try {
      const res = await api<OrderStatusResultDto>(`/api/orders/${order.id}/status`, { method: "POST", json: { status } });
      setNotices((n) => ({ ...n, [order.id]: res.notice.sent ? "Müşteriye mesaj gönderildi." : `Müşteriye mesaj GİTMEDİ: ${res.notice.error ?? "bilinmeyen sebep"}` }));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Siparişler{brand ? ` · ${brand.name}` : ""}</h1>
          <button
            onClick={soundOn ? () => setSoundOn(false) : enableSound}
            className={`rounded-lg border px-3 py-2 text-sm font-medium ${soundOn ? "border-green-600 bg-green-50 text-green-800" : "border-amber-500 bg-amber-50 text-amber-800"}`}
          >
            {soundOn ? "🔔 Ses açık (kapat)" : "🔕 Sesi aç"}
          </button>
        </div>
        {!soundOn && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Yeni sipariş geldiğinde sesli uyarı için bu sayfayı açık tutun ve &quot;Sesi aç&quot;a bir kez basın (tarayıcı kuralı).</p>}

        <div className="mb-4 flex gap-2">
          {(["active", "history"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === t ? "bg-brand-500 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
              {t === "active" ? "Aktif" : "Geçmiş"}
            </button>
          ))}
        </div>

        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!orders && !error && <p className="text-slate-500">Yükleniyor…</p>}
        {orders && orders.length === 0 && <p className="text-slate-500">{tab === "active" ? "Bekleyen sipariş yok." : "Henüz tamamlanan sipariş yok."}</p>}

        <ul className="space-y-4">
          {orders?.map((o) => {
            const step = next[o.status];
            return (
              <li key={o.id} className={`rounded-xl border bg-white p-4 ${o.status === "NEW" ? "border-red-400 ring-2 ring-red-100" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-lg font-semibold">#{o.id}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${label[o.status].cls}`}>{label[o.status].text}</span>
                  <span className="text-sm text-slate-500">{time(o.createdAt)}</span>
                  <span className="ml-auto text-lg font-semibold tabular-nums">{o.totalText}</span>
                </div>
                <p className="mt-1 text-sm text-slate-700">
                  <b>{o.customer.name ?? "İsimsiz müşteri"}</b>
                  {o.customer.phone ? ` · +${o.customer.phone}` : " · telefon yok"}
                </p>
                <ul className="mt-3 divide-y divide-slate-100 text-sm">
                  {o.items.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 py-1.5">
                      <span className="w-10 font-semibold tabular-nums">{i.quantity}×</span>
                      <span className="flex-1">{i.name}</span>
                      <span className="tabular-nums text-slate-500">{i.unitText}</span>
                      <span className="w-24 text-right tabular-nums">{i.lineText}</span>
                    </li>
                  ))}
                </ul>
                {o.note && <p className="mt-2 rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-900">Not: {o.note}</p>}
                {notices[o.id] && <p className={`mt-2 text-sm ${notices[o.id].includes("GİTMEDİ") ? "text-red-600" : "text-green-700"}`}>{notices[o.id]}</p>}
                {tab === "active" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {step && (
                      <button disabled={busyId === o.id} onClick={() => setStatus(o, step.to)} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
                        {step.text}
                      </button>
                    )}
                    <button disabled={busyId === o.id} onClick={() => setStatus(o, "CANCELLED")} className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
                      İptal et
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}

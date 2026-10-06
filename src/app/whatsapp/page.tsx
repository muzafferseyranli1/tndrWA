"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";

interface Status {
  configured: boolean;
  session: string | null;
  status: string | null;
  me: string | null;
  error: string | null;
  blockers: string[];
}
interface EventRow {
  id: number;
  receivedAt: string;
  session: string;
  event: string;
  messageType: string | null;
}
interface EventDetail extends EventRow {
  body: unknown;
}

const statusText: Record<string, { text: string; cls: string }> = {
  WORKING: { text: "Bağlı", cls: "bg-green-100 text-green-800" },
  SCAN_QR_CODE: { text: "QR bekleniyor", cls: "bg-amber-100 text-amber-800" },
  STARTING: { text: "Başlıyor", cls: "bg-blue-100 text-blue-800" },
  STOPPED: { text: "Durdu", cls: "bg-slate-200 text-slate-700" },
  FAILED: { text: "Hata", cls: "bg-red-100 text-red-700" },
  NOT_CREATED: { text: "Oturum yok", cls: "bg-slate-200 text-slate-700" },
};

export default function WhatsappPage() {
  const { brand } = useBrands();
  const brandId = brand?.id;
  const [status, setStatus] = useState<Status | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    if (brandId === undefined) return;
    try {
      const [s, e] = await Promise.all([api<Status>(`/api/whatsapp/status?brandId=${brandId}`), api<EventRow[]>(`/api/whatsapp/events?brandId=${brandId}&limit=40`)]);
      setStatus(s);
      setEvents(e);
      setTick((t) => t + 1);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [brandId]);

  // Durum ve olaylar 4 saniyede bir yenilenir (QR taranınca "Bağlı"ya dönmesi için)
  useEffect(() => {
    setStatus(null);
    setDetail(null);
    void refresh();
    const id = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function control(action: "start" | "stop") {
    setBusy(true);
    setError("");
    try {
      await api(`/api/whatsapp/${action}`, { method: "POST", json: { brandId } });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function open(id: number) {
    try {
      setDetail(await api<EventDetail>(`/api/whatsapp/events/${id}`));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const st = status?.status ? statusText[status.status] ?? { text: status.status, cls: "bg-slate-200 text-slate-700" } : null;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-semibold">WhatsApp{brand ? ` · ${brand.name}` : ""}</h1>
        <p className="mb-4 text-sm text-slate-500">Bu markanın WhatsApp numarasını (WhatsApp Business uygulaması) panele bağlar. Telefon en az 14 günde bir internete bağlanmalı.</p>

        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {status && status.blockers.length > 0 && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Bağlantı kapalı: {status.blockers.join("; ")}.</p>}
        {status?.error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">WAHA: {status.error}</p>}

        {status?.configured && (
          <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">Oturum: <code>{status.session}</code></span>
              {st && <span className={`rounded-full px-2 py-0.5 text-xs ${st.cls}`}>{st.text}</span>}
              {status.me && <span className="text-sm text-slate-600">{status.me}</span>}
              <div className="ml-auto flex gap-2">
                <button disabled={busy} onClick={() => control("start")} className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
                  {status.status === "NOT_CREATED" ? "Bağlantıyı oluştur" : "Başlat"}
                </button>
                <button disabled={busy} onClick={() => control("stop")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
                  Durdur
                </button>
              </div>
            </div>
            {status.status === "SCAN_QR_CODE" && (
              <div className="mt-4 flex flex-wrap items-start gap-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/whatsapp/qr?brandId=${brandId}&t=${tick}`} alt="WhatsApp QR kodu" className="h-64 w-64 rounded-lg border border-slate-200" />
                <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
                  <li>Telefonda <b>WhatsApp Business</b> uygulamasını açın.</li>
                  <li><b>Ayarlar → Bağlı cihazlar → Cihaz bağla</b>.</li>
                  <li>Bu QR kodunu okutun (kod yaklaşık 20 saniyede bir yenilenir).</li>
                </ol>
              </div>
            )}
          </section>
        )}

        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Son olaylar</h2>
          {events.length === 0 ? (
            <p className="text-sm text-slate-500">Henüz olay yok. Bağlantı kurulunca mesajlar ve durum değişiklikleri burada görünür.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
              {events.map((e) => (
                <li key={e.id}>
                  <button onClick={() => open(e.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-2 text-left hover:bg-slate-50">
                    <span className="w-40 tabular-nums text-slate-500">{new Date(e.receivedAt).toLocaleString("tr-TR")}</span>
                    <span className="font-medium">{e.event}</span>
                    {e.messageType && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{e.messageType}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {detail && (
          <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium">Olay #{detail.id}: {detail.event}</h3>
              <button onClick={() => setDetail(null)} className="text-sm text-slate-500 hover:underline">Kapat</button>
            </div>
            <pre className="max-h-96 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(detail.body, null, 2)}</pre>
          </section>
        )}
      </main>
    </>
  );
}

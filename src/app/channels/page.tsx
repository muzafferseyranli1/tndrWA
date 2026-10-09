"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";
import type { ChannelDto, ChannelListDto, ChannelStatsDto } from "@shared/types";

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500";

interface Draft {
  label: string;
  value: string;
  enabled: boolean;
}

function Row({ c, first, last, onMove, onSaved, clicks }: { c: ChannelDto; first: boolean; last: boolean; onMove: (d: "up" | "down") => void; onSaved: () => void; clicks: number }) {
  const [draft, setDraft] = useState<Draft>({ label: c.label, value: c.value, enabled: c.enabled });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = draft.label !== c.label || draft.value !== c.value || draft.enabled !== c.enabled;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await api<ChannelDto>(`/api/channels/${c.id}`, { method: "PUT", json: draft });
      setDraft({ label: saved.label, value: saved.value, enabled: saved.enabled });
      setMsg({ ok: true, text: "Kaydedildi." });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1">
          <button title="Yukarı al" disabled={first} onClick={() => onMove("up")} className="rounded border border-slate-300 px-1.5 text-[10px] leading-4 hover:bg-slate-50 disabled:opacity-30">▲</button>
          <button title="Aşağı al" disabled={last} onClick={() => onMove("down")} className="rounded border border-slate-300 px-1.5 text-[10px] leading-4 hover:bg-slate-50 disabled:opacity-30">▼</button>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} className="h-4 w-4" />
          Sayfada göster
        </label>
        <span className="text-xs text-slate-400">{c.kind}</span>
        <span className="ml-auto text-xs text-slate-500">{clicks} tıklama</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Buton yazısı</span>
          <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} maxLength={60} className={field} />
        </label>
        {c.kind !== "REVIEW" && (
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">{c.valueType === "phone" ? "Numara" : c.valueType === "place" ? "Adres / harita bağlantısı" : "Bağlantı"}</span>
          <input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} placeholder={c.valueHint} className={field} />
        </label>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button disabled={!dirty || busy} onClick={save} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40">
          {busy ? "Kaydediliyor…" : "Kaydet"}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</span>}
      </div>
    </li>
  );
}

export default function ChannelsPage() {
  const { brand } = useBrands();
  const brandId = brand?.id;
  const [data, setData] = useState<ChannelListDto | null>(null);
  const [stats, setStats] = useState<ChannelStatsDto | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (brandId === undefined) return;
    try {
      const [list, st] = await Promise.all([api<ChannelListDto>(`/api/channels?brandId=${brandId}`), api<ChannelStatsDto>(`/api/channels/stats?brandId=${brandId}&days=30`)]);
      setData(list);
      setStats(st);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [brandId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  async function move(id: number, direction: "up" | "down") {
    try {
      await api(`/api/channels/${id}/move`, { method: "POST", json: { direction } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-semibold">Sipariş kanalları{brand ? ` · ${brand.name}` : ""}</h1>
        <p className="mb-6 text-sm text-slate-500">Müşterilerin QR kodla açtığı sayfadaki butonlar. Numara ya da bağlantı girip &quot;Sayfada göster&quot;i açın; sıra buradaki sırayla aynıdır.</p>
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {data && brandId !== undefined && (
          <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 font-medium">QR kodları</h2>
            <div className="flex flex-wrap gap-6">
              {(["landing", "brand"] as const).map((target) => (
                <div key={target} className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/channels/qr?brandId=${brandId}&target=${target}`} alt="QR kod" width={160} height={160} className="mx-auto rounded-lg border border-slate-200" />
                  <p className="mt-2 text-sm font-medium">{target === "landing" ? "Marka seçimi (iki marka)" : `Yalnızca ${brand?.name ?? "bu marka"}`}</p>
                  <p className="break-all text-xs text-slate-400">{target === "landing" ? data.landingUrl : data.brandUrl}</p>
                  <a href={`/api/channels/qr?brandId=${brandId}&target=${target}&download=1`} className="mt-2 inline-block rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                    PNG indir
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}

        {stats && (
          <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Son {stats.days} gün: ana sayfa <b>{stats.landing}</b> görüntüleme · bu marka sayfası <b>{stats.brandVisits}</b> görüntüleme · toplam <b>{Object.values(stats.clicks).reduce((a, b) => a + b, 0)}</b> buton tıklaması
          </p>
        )}

        {!data && !error && <p className="text-slate-500">Yükleniyor…</p>}
        <ul className="space-y-3">
          {data?.channels.map((c, i) => (
            <Row key={`${brandId}-${c.id}-${c.label}-${c.value}-${c.enabled}`} c={c} first={i === 0} last={i === data.channels.length - 1} onMove={(d) => move(c.id, d)} onSaved={() => void load()} clicks={stats?.clicks[c.kind] ?? 0} />
          ))}
        </ul>
      </main>
    </>
  );
}

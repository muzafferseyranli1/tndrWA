"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";
import type { PaymentTypeDto } from "@shared/types";

const field = "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500";

function Row({ p, first, last, onMove, onSaved }: { p: PaymentTypeDto; first: boolean; last: boolean; onMove: (d: "up" | "down") => void; onSaved: () => void }) {
  const [draft, setDraft] = useState({ name: p.name, discountPercent: String(p.discountPercent), enabled: p.enabled });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = draft.name !== p.name || draft.discountPercent !== String(p.discountPercent) || draft.enabled !== p.enabled;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/payments/${p.id}`, { method: "PUT", json: { name: draft.name, discountPercent: Number(draft.discountPercent), enabled: draft.enabled } });
      setMsg({ ok: true, text: "Kaydedildi." });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-col gap-1">
        <button title="Yukarı al" disabled={first} onClick={() => onMove("up")} className="rounded border border-slate-300 px-1.5 text-[10px] leading-4 hover:bg-slate-50 disabled:opacity-30">▲</button>
        <button title="Aşağı al" disabled={last} onClick={() => onMove("down")} className="rounded border border-slate-300 px-1.5 text-[10px] leading-4 hover:bg-slate-50 disabled:opacity-30">▼</button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} className="h-4 w-4" />
        Açık
      </label>
      <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={24} aria-label="Ödeme şekli adı" className={`${field} min-w-40 flex-1`} />
      <label className="flex items-center gap-1 text-sm text-slate-600">
        İndirim %
        <input type="number" min={0} max={90} value={draft.discountPercent} onChange={(e) => setDraft({ ...draft, discountPercent: e.target.value })} aria-label="İndirim yüzdesi" className={`${field} w-20`} />
      </label>
      <button disabled={!dirty || busy} onClick={save} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40">
        Kaydet
      </button>
      {msg && <span className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</span>}
    </li>
  );
}

export default function PaymentsPage() {
  const { brand } = useBrands();
  const brandId = brand?.id;
  const [items, setItems] = useState<PaymentTypeDto[] | null>(null);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    if (brandId === undefined) return;
    try {
      setItems(await api<PaymentTypeDto[]>(`/api/payments?brandId=${brandId}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [brandId]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  async function move(id: number, direction: "up" | "down") {
    try {
      await api(`/api/payments/${id}/move`, { method: "POST", json: { direction } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function add() {
    if (!newName.trim()) return;
    try {
      await api("/api/payments", { method: "POST", json: { brandId, name: newName, discountPercent: 0, enabled: false } });
      setNewName("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-semibold">Ödeme şekilleri{brand ? ` · ${brand.name}` : ""}</h1>
        <p className="mb-6 text-sm text-slate-500">
          Müşteri sepeti gönderince WhatsApp&apos;ta bu liste çıkar. İndirim, sepetin liste fiyatı toplamı üzerinden uygulanır. Açık ödeme şekilleri sıra buradaki sıradır (en fazla 10).
        </p>
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!items && !error && <p className="text-slate-500">Yükleniyor…</p>}
        <ul className="space-y-2">
          {items?.map((p, i) => (
            <Row key={`${brandId}-${p.id}-${p.name}-${p.discountPercent}-${p.enabled}`} p={p} first={i === 0} last={i === items.length - 1} onMove={(d) => move(p.id, d)} onSaved={() => void load()} />
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={24} placeholder="Yeni ödeme şekli (örn. Pluxee)" className={`${field} flex-1`} />
          <button onClick={add} className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">Ekle</button>
        </div>
      </main>
    </>
  );
}

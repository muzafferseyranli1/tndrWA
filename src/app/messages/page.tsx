"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";
import type { MessageTemplateDto } from "@shared/types";

export default function MessagesPage() {
  const { brand } = useBrands();
  const brandId = brand?.id;
  const [items, setItems] = useState<MessageTemplateDto[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (brandId === undefined) return;
    try {
      const list = await api<MessageTemplateDto[]>(`/api/messages?brandId=${brandId}`);
      setItems(list);
      setDrafts(Object.fromEntries(list.map((m) => [m.key, m.text])));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [brandId]);

  useEffect(() => {
    setItems(null);
    setSaved({});
    void load();
  }, [load]);

  async function save(key: string, text: string) {
    setError("");
    try {
      const updated = await api<MessageTemplateDto>(`/api/messages/${key}`, { method: "PUT", json: { brandId, text } });
      setItems((list) => list?.map((m) => (m.key === key ? updated : m)) ?? null);
      setDrafts((d) => ({ ...d, [key]: updated.text }));
      setSaved((s) => ({ ...s, [key]: text.trim() === "" || updated.isDefault ? "Varsayılana döndü." : "Kaydedildi." }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-semibold">Mesajlar{brand ? ` · ${brand.name}` : ""}</h1>
        <p className="mb-6 text-sm text-slate-500">
          Müşteriye giden otomatik mesajların metinleri. Her marka için ayrıdır. <code>{"{ad}"}</code> müşterinin WhatsApp adı, <code>{"{no}"}</code> sipariş numarasıdır. Metni silip kaydederseniz varsayılana döner.
        </p>
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!items && !error && <p className="text-slate-500">Yükleniyor…</p>}
        <ul className="space-y-4">
          {items?.map((m) => {
            const draft = drafts[m.key] ?? m.text;
            const dirty = draft !== m.text;
            return (
              <li key={m.key} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{m.label}</h2>
                  {!m.isDefault && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">Özelleştirilmiş</span>}
                </div>
                <p className="mb-2 text-xs text-slate-500">{m.hint}</p>
                <textarea
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [m.key]: e.target.value }))}
                  rows={3}
                  maxLength={1000}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button disabled={!dirty} onClick={() => save(m.key, draft)} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40">
                    Kaydet
                  </button>
                  {!m.isDefault && (
                    <button onClick={() => save(m.key, "")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
                      Varsayılana dön
                    </button>
                  )}
                  {saved[m.key] && !dirty && <span className="text-sm text-green-700">{saved[m.key]}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import ChatThread, { nameOf, when } from "@/components/ChatThread";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";
import type { ChatConversationDto } from "@shared/types";

const LIST_POLL_MS = 5000;

export default function ChatPage() {
  const { brand } = useBrands();
  const brandId = brand?.id;
  const [list, setList] = useState<ChatConversationDto[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    if (brandId === undefined) return;
    try {
      setList(await api<ChatConversationDto[]>(`/api/chat/conversations?brandId=${brandId}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [brandId]);

  useEffect(() => {
    setList(null);
    setSelected(null);
    void loadList();
    const t = setInterval(() => void loadList(), LIST_POLL_MS);
    return () => clearInterval(t);
  }, [loadList]);

  const unreadTotal = (list ?? []).reduce((sum, c) => sum + c.unread, 0);
  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) Yazışma · tndrWA` : "Yazışma · tndrWA";
  }, [unreadTotal]);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold">Yazışma{brand ? ` · ${brand.name}` : ""}</h1>
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="grid min-h-[28rem] gap-4 md:grid-cols-[18rem_1fr]">
          <aside className="rounded-xl border border-slate-200 bg-white">
            {!list && !error && <p className="p-4 text-sm text-slate-500">Yükleniyor…</p>}
            {list && list.length === 0 && <p className="p-4 text-sm text-slate-500">Henüz yazışma yok. Müşteriler yazınca burada görünür.</p>}
            <ul className="divide-y divide-slate-100">
              {list?.map((c) => (
                <li key={c.customerId}>
                  <button onClick={() => setSelected(c.customerId)} className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${selected === c.customerId ? "bg-slate-50" : ""}`}>
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate font-medium">{nameOf(c)}</span>
                      {c.unread > 0 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-medium text-white">{c.unread}</span>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="flex-1 truncate">{c.lastDirection === "OUT" ? "Siz: " : ""}{c.lastBody}</span>
                      <span>{when(c.lastAt)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="flex flex-col rounded-xl border border-slate-200 bg-white">
            {selected === null && <p className="p-6 text-sm text-slate-500">Soldan bir konuşma seçin.</p>}
            {selected !== null && brandId !== undefined && <ChatThread key={selected} brandId={brandId} customerId={selected} onChanged={() => void loadList()} />}
          </section>
        </div>
      </main>
    </>
  );
}

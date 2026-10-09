"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ChatMessageDto, ChatThreadDto } from "@shared/types";

const THREAD_POLL_MS = 3000;

export const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export const nameOf = (c: { name: string | null; phone: string | null }) => c.name ?? (c.phone ? `+${c.phone}` : "İsimsiz müşteri");

function Ticks({ m }: { m: ChatMessageDto }) {
  if (m.direction !== "OUT") return null;
  if (m.status === "FAILED") return <span className="text-red-600" title={m.error ?? "Teslim edilemedi"}>⚠ gitmedi</span>;
  if (m.status === "READ") return <span className="text-blue-500" title="Okundu">✓✓</span>;
  if (m.status === "DELIVERED") return <span title="Teslim edildi">✓✓</span>;
  return <span title="Gönderildi">✓</span>;
}

/** Tek müşteriyle yazışma: mesajlar, gönderme kutusu, 24 saat penceresi uyarısı. Yazışma sayfasında ve sipariş kartındaki pencerede kullanılır. */
export default function ChatThread({ brandId, customerId, maxHeight = "28rem", onChanged }: { brandId: number; customerId: number; maxHeight?: string; onChanged?: () => void }) {
  const [thread, setThread] = useState<ChatThreadDto | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const loadThread = useCallback(async () => {
    try {
      setThread(await api<ChatThreadDto>(`/api/chat/${customerId}?brandId=${brandId}&read=1`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [brandId, customerId]);

  useEffect(() => {
    setThread(null);
    lastCount.current = 0;
    void loadThread();
    const t = setInterval(() => void loadThread(), THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [loadThread]);

  // Yeni mesaj gelince (ya da konuşma ilk açılınca) en alta kaydır
  useEffect(() => {
    const n = thread?.messages.length ?? 0;
    if (n !== lastCount.current) {
      lastCount.current = n;
      bottom.current?.scrollIntoView({ block: "end" });
    }
  }, [thread]);

  async function send(kind: "send" | "catalog") {
    const text = draft.trim();
    if (kind === "send" && !text) return;
    setSending(true);
    setError("");
    try {
      await api(`/api/chat/${customerId}/${kind}`, { method: "POST", json: { brandId, ...(kind === "send" || text ? { text } : {}) } });
      if (kind === "send" || text) setDraft("");
      await loadThread();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {error && <p role="alert" className="m-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!thread && !error && <p className="p-6 text-sm text-slate-500">Yükleniyor…</p>}
      {thread && (
              <>
                <div className="border-b border-slate-100 px-4 py-3">
                  <div className="font-medium">{nameOf(thread.customer)}</div>
                  <div className="text-xs text-slate-500">{thread.customer.phone ? `+${thread.customer.phone}` : "telefon yok"}</div>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3" style={{ maxHeight }}>
                  {thread.messages.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === "OUT" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.direction === "OUT" ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-900"}`}>
                        {m.type === "order" && m.orderId ? (
                          <Link href="/orders" className="font-medium underline">
                            🛒 {m.body}
                          </Link>
                        ) : (
                          <span className="whitespace-pre-wrap break-words">{m.type === "catalog" ? `🛍 Katalog: ${m.body}` : m.body}</span>
                        )}
                        <div className={`mt-1 flex items-center justify-end gap-2 text-[10px] ${m.direction === "OUT" ? "text-white/80" : "text-slate-500"}`}>
                          <span>{when(m.createdAt)}</span>
                          <Ticks m={m} />
                        </div>
                        {m.status === "FAILED" && m.error && <div className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{m.error}</div>}
                      </div>
                    </div>
                  ))}
                  <div ref={bottom} />
                </div>
                <div className="border-t border-slate-100 p-3">
                  {!thread.windowOpen && (
                    <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      24 saat penceresi kapalı: müşteri son 24 saatte yazmadığı için serbest mesaj gönderemezsiniz. Müşteri yazınca açılır.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void send("send");
                        }
                      }}
                      rows={2}
                      maxLength={1000}
                      disabled={!thread.windowOpen}
                      placeholder={thread.windowOpen ? "Mesaj yazın (Enter gönderir, Shift+Enter yeni satır)" : "Pencere kapalı"}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:bg-slate-50"
                    />
                    <div className="flex flex-col gap-2">
                      <button disabled={sending || !thread.windowOpen || !draft.trim()} onClick={() => send("send")} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40">
                        Gönder
                      </button>
                      <button disabled={sending || !thread.windowOpen} onClick={() => send("catalog")} className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-40" title="Müşteriye katalog düğmesi gönderir">
                        Katalog gönder
                      </button>
                    </div>
                  </div>
                </div>
              </>
      )}
    </>
  );
}

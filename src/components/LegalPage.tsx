"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LegalDto } from "@shared/types";

/** Herkese açık gizlilik / aydınlatma metni ("/gizlilik"). İçerik ayarlardaki işletme bilgilerinden üretilir. */
export function PolicyPage() {
  const [data, setData] = useState<LegalDto | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/public/legal")
      .then((r) => (r.ok ? (r.json() as Promise<LegalDto>) : Promise.reject(new Error("yüklenemedi"))))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold text-brand-700">Gizlilik Politikası ve KVKK Aydınlatma Metni</h1>
      {failed && <p className="mt-4 text-red-700">Sayfa şu anda yüklenemedi. Lütfen biraz sonra tekrar deneyin.</p>}
      {!data && !failed && <p className="mt-4 text-slate-500">Yükleniyor…</p>}
      {data && !data.ready && <p className="mt-4 text-slate-600">Bu sayfa hazırlanıyor.</p>}
      {data?.ready && (
        <>
          <p className="mb-6 text-sm text-slate-500">{data.brandName}</p>
          <div className="space-y-6">
            {data.sections.map((s) => (
              <section key={s.title}>
                <h2 className="mb-2 text-lg font-semibold">{s.title}</h2>
                {s.paragraphs.map((p) => (
                  <p key={p} className="mb-2 whitespace-pre-line leading-relaxed text-slate-700">
                    {p}
                  </p>
                ))}
              </section>
            ))}
          </div>
          <p className="mt-8 text-sm">
            <Link href="/veri-silme" className="text-brand-600 underline">
              Verilerimin silinmesini istiyorum
            </Link>
          </p>
        </>
      )}
    </main>
  );
}

/** Herkese açık veri silme talebi ("/veri-silme"). Meta uygulaması için "veri silme talimatları" adresi olarak da kullanılır. */
export function DeletionPage() {
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/public/deletion-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, note: note.trim() || undefined }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Talep gönderilemedi.");
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold text-brand-700">Verilerimin silinmesini istiyorum</h1>
      <p className="mb-6 leading-relaxed text-slate-700">
        WhatsApp ya da diğer kanallardan sipariş verirken kullandığınız telefon numarasını yazın. Bu numaraya ait yazışmaları, kayıtlı adreslerinizi ve kişisel bilgilerinizi sileriz; mali kayıt niteliğindeki sipariş kayıtları adres ve ad bilgisi olmadan saklanır.
        Talebiniz en geç otuz gün içinde sonuçlandırılır. Ayrıntılar için{" "}
        <Link href="/gizlilik" className="text-brand-600 underline">
          gizlilik metnine
        </Link>{" "}
        bakabilirsiniz.
      </p>
      {done ? (
        <p className="rounded-2xl bg-green-50 p-4 text-green-900">Talebiniz alındı. Teşekkür ederiz.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="mb-1 block text-sm text-slate-600">Telefon numaranız</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={25} placeholder="0533 123 45 67" className="w-full rounded-xl border border-slate-300 px-3 py-3 text-base outline-none focus:border-brand-500" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-600">Eklemek istedikleriniz (isteğe bağlı)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand-500" />
          </label>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={busy || !phone.trim()} onClick={submit} className="min-h-[3.25rem] rounded-2xl bg-brand-600 text-lg font-semibold text-white disabled:opacity-40 active:bg-brand-700">
            {busy ? "Gönderiliyor…" : "Talebi gönder"}
          </button>
        </div>
      )}
    </main>
  );
}

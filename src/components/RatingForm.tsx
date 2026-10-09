"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { RatingContextDto, RatingResultDto } from "@shared/types";

const QUESTIONS = [
  { key: "taste", title: "Lezzet", hint: "Yemeklerin tadı ve sıcaklığı" },
  { key: "care", title: "Hizmet", hint: "Sipariş alma, ilgi ve iletişim" },
  { key: "delivery", title: "Servis", hint: "Teslimat süresi ve paketleme" },
] as const;
type Key = (typeof QUESTIONS)[number]["key"];

function Stars({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex justify-between gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} yıldız`}
          onClick={() => onChange(n)}
          className={`h-14 flex-1 rounded-xl text-3xl ${n <= value ? "bg-amber-400 text-white" : "bg-slate-100 text-slate-300"} active:scale-95`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

/** Herkese açık "Bizi değerlendirin" sayfası: 3 soru (1-5 yıldız), yorum, düşük puanda geri arama bilgisi. */
export default function RatingForm({ code, token }: { code: string; token: string | null }) {
  const [ctx, setCtx] = useState<RatingContextDto | null>(null);
  const [state, setState] = useState<"loading" | "form" | "invalid" | "failed" | "done">("loading");
  const [scores, setScores] = useState<Record<Key, number>>({ taste: 0, care: 0, delivery: 0 });
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RatingResultDto | null>(null);

  useEffect(() => {
    const q = new URLSearchParams({ brand: code, ...(token ? { t: token } : {}) });
    fetch(`/api/public/rating?${q}`)
      .then(async (r) => {
        if (r.status === 404) return setState("invalid");
        if (!r.ok) return setState("failed");
        setCtx((await r.json()) as RatingContextDto);
        setState("form");
      })
      .catch(() => setState("failed"));
  }, [code, token]);

  const complete = QUESTIONS.every((q) => scores[q.key] > 0);
  const low = QUESTIONS.some((q) => scores[q.key] > 0 && scores[q.key] < 4);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/public/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: code, ...(token ? { t: token } : {}), ...scores, comment: comment.trim() || undefined, name: name.trim() || undefined, phone: phone.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as RatingResultDto & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Gönderilemedi. Lütfen tekrar deneyin.");
      setResult(data);
      setState("done");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-5 px-4 py-6">
      <Link href={`/m/${code}`} className="text-sm text-slate-500 hover:text-brand-700">
        ← Sipariş seçenekleri
      </Link>
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-brand-700">{ctx?.brandName ?? ""}</h1>
        <p className="mt-1 text-lg text-slate-600">Bizi değerlendirin</p>
      </header>

      {state === "loading" && <p className="text-center text-slate-500">Yükleniyor…</p>}
      {state === "failed" && <p className="text-center text-red-700">Sayfa şu anda yüklenemedi. Lütfen biraz sonra tekrar deneyin.</p>}
      {state === "invalid" && <p className="text-center text-slate-600">Bu değerlendirme bağlantısı geçersiz. Lütfen mesajdaki bağlantıyı yeniden açın.</p>}
      {state === "form" && ctx?.alreadyRated && <p className="rounded-2xl bg-green-50 p-4 text-center text-green-800">Bu sipariş için değerlendirmenizi zaten aldık, teşekkür ederiz.</p>}

      {state === "form" && !ctx?.alreadyRated && (
        <div className="flex flex-col gap-5">
          {ctx?.orderNo && <p className="text-center text-sm text-slate-500">Sipariş No: {ctx.orderNo}</p>}
          {QUESTIONS.map((q) => (
            <section key={q.key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold">{q.title}</h2>
              <p className="mb-3 text-sm text-slate-500">{q.hint}</p>
              <Stars value={scores[q.key]} onChange={(v) => setScores((s) => ({ ...s, [q.key]: v }))} label={q.title} />
            </section>
          ))}

          <label className="block">
            <span className="mb-1 block text-sm text-slate-600">Eklemek istedikleriniz (isteğe bağlı)</span>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={1000} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand-500" />
          </label>

          {low && (
            <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
              <p className="font-medium text-amber-900">Yaşadığınız sorun için üzgünüz.</p>
              <p className="mb-3 text-sm text-amber-900">{token ? "Sorunu çözmek için sizi arayabiliriz. Dilerseniz bir telefon numarası bırakın." : "Sorunu çözmek için sizi arayabiliriz. Adınızı ve telefon numaranızı bırakabilirsiniz."}</p>
              <div className="flex flex-col gap-2">
                {!token && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Adınız" maxLength={60} className="rounded-xl border border-amber-300 bg-white px-3 py-3 text-base" />}
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefon (örn. 0533 123 45 67)" inputMode="tel" maxLength={25} className="rounded-xl border border-amber-300 bg-white px-3 py-3 text-base" />
              </div>
            </section>
          )}

          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={!complete || busy} onClick={submit} className="min-h-[3.5rem] rounded-2xl bg-brand-600 text-lg font-semibold text-white shadow-md disabled:opacity-40 active:bg-brand-700">
            {busy ? "Gönderiliyor…" : complete ? "Gönder" : "Üç soruyu da yıldızlayın"}
          </button>
        </div>
      )}

      {state === "done" && result && (
        <div className="flex flex-col gap-4">
          <section className="rounded-2xl bg-green-50 p-5 text-center text-green-900">
            <p className="text-xl font-semibold">Teşekkür ederiz!</p>
            <p className="mt-1">{result.low ? "Geri bildiriminiz bize ulaştı. En kısa sürede sizinle ilgileneceğiz." : "Değerlendirmeniz bizim için çok değerli."}</p>
          </section>
        </div>
      )}
    </main>
  );
}

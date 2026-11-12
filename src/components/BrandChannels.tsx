"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trackHit } from "@/lib/track";
import type { PublicBrandDto } from "@shared/types";

// Tailwind sınıfları tam yazılmalı (dinamik birleştirilirse derlemeye girmez)
const STYLE: Record<string, { cls: string; icon: string }> = {
  CALL: { cls: "bg-emerald-700 text-white", icon: "📞" },
  WHATSAPP: { cls: "bg-[#128C7E] text-white", icon: "💬" },
  TELEGRAM: { cls: "bg-[#229ED9] text-white", icon: "✈️" },
  YEMEKSEPETI: { cls: "bg-[#fa0050] text-white", icon: "🛵" },
  // Trendyol Go, Türkiye'de Uber Eats adına geçti: markanın siyah/yeşil renkleri
  TRENDYOLGO: { cls: "bg-black text-[#06C167]", icon: "🛵" },
  GETIR: { cls: "bg-[#5d3ebc] text-white", icon: "🛵" },
  MAPS: { cls: "bg-[#1a73e8] text-white", icon: "📍" },
  REVIEW: { cls: "bg-amber-400 text-slate-900", icon: "⭐" },
};

// Kanal başına indirim patlangıcı: Telegram ve WhatsApp %15 (zıplar), telefonla arama %10 (sabit)
const BURST: Record<string, { pct: number; bounce: boolean }> = {
  TELEGRAM: { pct: 15, bounce: true },
  WHATSAPP: { pct: 15, bounce: true },
  CALL: { pct: 10, bounce: false },
};
const BURST_CLIP = "polygon(50.0% 0.0%, 57.4% 12.7%, 69.1% 3.8%, 71.1% 18.4%, 85.4% 14.6%, 81.6% 28.9%, 96.2% 30.9%, 87.3% 42.6%, 100.0% 50.0%, 87.3% 57.4%, 96.2% 69.1%, 81.6% 71.1%, 85.4% 85.4%, 71.1% 81.6%, 69.1% 96.2%, 57.4% 87.3%, 50.0% 100.0%, 42.6% 87.3%, 30.9% 96.2%, 28.9% 81.6%, 14.6% 85.4%, 18.4% 71.1%, 3.8% 69.1%, 12.7% 57.4%, 0.0% 50.0%, 12.7% 42.6%, 3.8% 30.9%, 18.4% 28.9%, 14.6% 14.6%, 28.9% 18.4%, 30.9% 3.8%, 42.6% 12.7%)";

function Burst({ pct, bounce }: { pct: number; bounce: boolean }) {
  return (
    <span
      aria-label={`%${pct} indirim`}
      className={`pointer-events-none absolute -right-2 -top-3 z-10 flex h-[4.5rem] w-[4.5rem] rotate-12 flex-col items-center justify-center bg-yellow-300 text-red-600 drop-shadow-md ${bounce ? "burst-bounce" : ""}`}
      style={{ clipPath: BURST_CLIP }}
    >
      <span className="text-lg font-extrabold leading-none">%{pct}</span>
      <span className="text-[0.6rem] font-extrabold leading-none">İNDİRİM</span>
    </span>
  );
}

/** Marka sayfası: sipariş kanalları, her biri ekranı yatay dolduran büyük buton. */
export default function BrandChannels({ code }: { code: string }) {
  const [brand, setBrand] = useState<PublicBrandDto | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "failed">("loading");

  useEffect(() => {
    trackHit({ event: "brand", brand: code });
    fetch(`/api/public/brands/${encodeURIComponent(code)}`)
      .then(async (r) => {
        if (r.status === 404) return setState("missing");
        if (!r.ok) return setState("failed");
        setBrand((await r.json()) as PublicBrandDto);
        setState("ready");
      })
      .catch(() => setState("failed"));
  }, [code]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 px-4 py-6">
      <style>{`@keyframes burstbounce{0%,100%{transform:rotate(12deg) translateY(0) scale(1)}25%{transform:rotate(12deg) translateY(-9px) scale(1.12)}50%{transform:rotate(12deg) translateY(0) scale(1)}65%{transform:rotate(12deg) translateY(-4px) scale(1.05)}80%{transform:rotate(12deg) translateY(0) scale(1)}}.burst-bounce{animation:burstbounce 1.4s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.burst-bounce{animation:none}}`}</style>
      <Link href="/" className="text-sm text-slate-500 hover:text-brand-700">
        ← Markalar
      </Link>
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-brand-700">{brand?.name ?? ""}</h1>
        <p className="mt-1 text-lg text-slate-600">Nasıl sipariş vermek istersiniz?</p>
      </header>

      {state === "loading" && <p className="text-center text-slate-500">Yükleniyor…</p>}
      {state === "failed" && <p className="text-center text-red-700">Sayfa şu anda yüklenemedi. Lütfen biraz sonra tekrar deneyin.</p>}
      {state === "missing" && <p className="text-center text-slate-600">Bu sayfa bulunamadı.</p>}
      {state === "ready" && brand && brand.channels.length === 0 && <p className="text-center text-slate-600">Sipariş seçenekleri çok yakında burada olacak.</p>}

      <div className="flex flex-col gap-3">
        {brand?.channels.map((c) => {
          const style = STYLE[c.kind] ?? { cls: "bg-slate-800 text-white", icon: "➡️" };
          // Bağlantısı henüz olmayan kanal: tıklanamaz, "Çok yakında" etiketli
          if (!c.href) {
            return (
              <div
                key={c.kind}
                aria-disabled="true"
                className={`flex min-h-[5rem] w-full cursor-not-allowed flex-col items-center justify-center gap-1 rounded-2xl px-5 py-4 text-center opacity-55 ${style.cls}`}
              >
                <span className="flex items-center gap-3 text-xl font-semibold">
                  <span aria-hidden="true" className="text-2xl">
                    {style.icon}
                  </span>
                  <span>{c.label}</span>
                </span>
                <span className="text-sm font-medium opacity-90">Çok yakında</span>
              </div>
            );
          }
          return (
            <a
              key={c.kind}
              href={c.href}
              onClick={() => trackHit({ event: "click", brand: code, kind: c.kind })}
              className={`relative flex min-h-[5rem] w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-center text-xl font-semibold shadow-md active:scale-[0.98] ${style.cls}`}
            >
              <span aria-hidden="true" className="text-2xl">
                {style.icon}
              </span>
              <span>{c.label}</span>
              {BURST[c.kind] && <Burst {...BURST[c.kind]} />}
            </a>
          );
        })}
      </div>
    </main>
  );
}

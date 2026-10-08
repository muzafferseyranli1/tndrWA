"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trackHit } from "@/lib/track";
import type { PublicBrandDto } from "@shared/types";

// Tailwind sınıfları tam yazılmalı (dinamik birleştirilirse derlemeye girmez)
const STYLE: Record<string, { cls: string; icon: string }> = {
  CALL: { cls: "bg-emerald-700 text-white", icon: "📞" },
  WHATSAPP: { cls: "bg-[#128C7E] text-white", icon: "💬" },
  YEMEKSEPETI: { cls: "bg-[#fa0050] text-white", icon: "🛵" },
  TRENDYOLGO: { cls: "bg-[#f27a1a] text-white", icon: "🛵" },
  GETIR: { cls: "bg-[#5d3ebc] text-white", icon: "🛵" },
  MAPS: { cls: "bg-[#1a73e8] text-white", icon: "📍" },
  REVIEW: { cls: "bg-amber-400 text-slate-900", icon: "⭐" },
};

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
          return (
            <a
              key={c.kind}
              href={c.href}
              onClick={() => trackHit({ event: "click", brand: code, kind: c.kind })}
              className={`flex min-h-[5rem] w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-center text-xl font-semibold shadow-md active:scale-[0.98] ${style.cls}`}
            >
              <span aria-hidden="true" className="text-2xl">
                {style.icon}
              </span>
              <span>{c.label}</span>
            </a>
          );
        })}
      </div>
    </main>
  );
}

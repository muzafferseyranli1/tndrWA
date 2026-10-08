"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trackHit } from "@/lib/track";

interface BrandItem {
  code: string;
  name: string;
}

/** Herkese açık açılış sayfası: iki büyük marka butonu. Telefonda tek elle basılacak boyutta. */
export default function BrandPicker() {
  const [brands, setBrands] = useState<BrandItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    trackHit({ event: "landing" });
    fetch("/api/public/brands")
      .then((r) => (r.ok ? (r.json() as Promise<BrandItem[]>) : Promise.reject(new Error("liste alınamadı"))))
      .then(setBrands)
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-10">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-brand-700">Yerinde</h1>
        <p className="mt-2 text-lg text-slate-600">Sipariş vermek istediğiniz markayı seçin</p>
      </header>

      {!brands && !failed && <p className="text-center text-slate-500">Yükleniyor…</p>}
      {failed && <p className="text-center text-red-700">Sayfa şu anda yüklenemedi. Lütfen biraz sonra tekrar deneyin.</p>}

      <nav className="flex flex-col gap-4">
        {brands?.map((b) => (
          <Link
            key={b.code}
            href={`/m/${b.code}`}
            className="flex min-h-[7.5rem] items-center justify-center rounded-3xl bg-brand-600 px-6 text-center text-2xl font-semibold text-white shadow-lg active:scale-[0.98] active:bg-brand-700"
          >
            {b.name}
          </Link>
        ))}
      </nav>
    </main>
  );
}

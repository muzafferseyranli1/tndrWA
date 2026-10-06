"use client";

import { useState } from "react";
import type { ProductDto } from "@shared/types";

const MAX_MB = 5;

export default function ImageUploader({ product, onChange }: { product: ProductDto; onChange: (p: ProductDto) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  async function send(request: () => Promise<Response>) {
    setBusy(true);
    setError("");
    setWarning("");
    try {
      const res = await request();
      const data = (await res.json().catch(() => ({}))) as { error?: string; product?: ProductDto; warning?: string | null };
      if (!res.ok || !data.product) {
        setError(data.error ?? "İşlem başarısız.");
        return;
      }
      onChange(data.product);
      if (data.warning) setWarning(data.warning);
    } catch {
      setError("Sunucuya ulaşılamadı.");
    } finally {
      setBusy(false);
    }
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Görsel en fazla ${MAX_MB} MB olabilir.`);
      return;
    }
    const form = new FormData();
    form.append("image", file);
    void send(() => fetch(`/api/products/${product.id}/image`, { method: "POST", body: form }));
  }

  return (
    <div className="space-y-2 text-sm">
      <span className="block text-slate-600">Ürün görseli</span>
      <div className="flex items-center gap-4">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt={product.name} className="h-24 w-24 rounded-lg border border-slate-200 object-cover" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">Görsel yok</div>
        )}
        <div className="space-y-2">
          <label className="inline-block cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            {busy ? "Yükleniyor…" : product.imageUrl ? "Görseli değiştir" : "Görsel yükle"}
            <input type="file" accept="image/jpeg,image/png" onChange={onFile} disabled={busy} className="hidden" />
          </label>
          {product.imageUrl && (
            <button type="button" disabled={busy} onClick={() => send(() => fetch(`/api/products/${product.id}/image`, { method: "DELETE" }))} className="ml-2 text-red-600 hover:underline">
              Kaldır
            </button>
          )}
          <p className="text-xs text-slate-500">JPEG veya PNG, en fazla {MAX_MB} MB. Meta için en az 500x500 px önerilir.</p>
        </div>
      </div>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {warning && <p className="text-amber-700">{warning}</p>}
    </div>
  );
}

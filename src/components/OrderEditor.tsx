"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { OrderDto, PaymentTypeDto, ProductDto } from "@shared/types";

const field = "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500";
const displayName = (p: ProductDto) => (p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name);

/** Sipariş kartındaki düzenleme paneli: ürünler, adet, not, adres, ödeme şekli. Her işlem hemen kaydedilir; müşteriye bildirim ayrı düğmeyle gider. */
export default function OrderEditor({ order, onChanged, onClose }: { order: OrderDto; onChanged: () => void; onClose: () => void }) {
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [payments, setPayments] = useState<PaymentTypeDto[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState<number | "">("");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState(order.note);
  const [address, setAddress] = useState(order.address);
  const [addressId, setAddressId] = useState<number | null>(null);
  const [saved, setSaved] = useState<{ id: number; text: string; hasLocation: boolean }[]>([]);
  const [paymentTypeId, setPaymentTypeId] = useState<number | "">(order.paymentTypeId ?? "");

  useEffect(() => {
    api<ProductDto[]>(`/api/products?brandId=${order.brandId}`).then(setProducts).catch((e: Error) => setError(e.message));
    api<PaymentTypeDto[]>(`/api/payments?brandId=${order.brandId}`).then(setPayments).catch(() => undefined);
    api<{ id: number; text: string; hasLocation: boolean }[]>(`/api/customers/${order.customerId}/addresses`).then(setSaved).catch(() => undefined);
  }, [order.brandId, order.customerId]);

  const choices = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return products.filter((p) => p.availability === "IN_STOCK" && (!q || displayName(p).toLocaleLowerCase("tr").includes(q))).slice(0, 60);
  }, [products, query]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const base = `/api/orders/${order.id}`;
  const detailsDirty = note !== order.note || address !== order.address || (paymentTypeId !== "" && paymentTypeId !== order.paymentTypeId);

  return (
    <div className="mt-3 rounded-xl border border-brand-500/30 bg-brand-50 p-3 text-sm">
      <div className="mb-2 flex items-center">
        <b>Siparişi düzenle</b>
        <button onClick={onClose} className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50">
          Kapat
        </button>
      </div>
      {error && <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}

      <ul className="divide-y divide-slate-200 rounded-lg bg-white">
        {order.items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="min-w-40 flex-1">{i.name}</span>
            <span className="tabular-nums text-slate-500">{i.unitText}</span>
            <div className="flex items-center gap-1">
              <button disabled={busy || i.quantity <= 1} onClick={() => run(() => api(`${base}/items/${i.id}`, { method: "PATCH", json: { quantity: i.quantity - 1 } }))} aria-label="Azalt" className="h-8 w-8 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-30">−</button>
              <span className="w-8 text-center font-semibold tabular-nums">{i.quantity}</span>
              <button disabled={busy || i.quantity >= 99} onClick={() => run(() => api(`${base}/items/${i.id}`, { method: "PATCH", json: { quantity: i.quantity + 1 } }))} aria-label="Artır" className="h-8 w-8 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-30">+</button>
            </div>
            <span className="w-24 text-right tabular-nums">{i.lineText}</span>
            <button disabled={busy} onClick={() => run(() => api(`${base}/items/${i.id}`, { method: "DELETE" }))} aria-label="Ürünü çıkar" title="Ürünü çıkar" className="rounded-lg border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-30">
              Çıkar
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1">
          <span className="mb-1 block text-xs text-slate-500">Ürün ekle</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ürün ara…" className={`${field} mb-1 w-full`} />
          <select value={pick} onChange={(e) => setPick(e.target.value ? Number(e.target.value) : "")} className={`${field} w-full`}>
            <option value="">Ürün seçin ({choices.length})</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {displayName(p)} — {p.priceText}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs text-slate-500">Adet</span>
          <input type="number" min={1} max={99} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className={`${field} w-20`} />
        </label>
        <button disabled={busy || pick === ""} onClick={() => run(async () => { await api(`${base}/items`, { method: "POST", json: { productId: pick, quantity: qty } }); setPick(""); setQty(1); })} className="rounded-lg bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-600 disabled:opacity-40">
          Ekle
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">Ödeme şekli (değişince indirim yeniden hesaplanır)</span>
          <select value={paymentTypeId} onChange={(e) => setPaymentTypeId(e.target.value ? Number(e.target.value) : "")} className={`${field} w-full`}>
            {order.paymentTypeId === null && <option value="">Seçilmemiş</option>}
            {payments
              .filter((p) => p.enabled || p.id === order.paymentTypeId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.discountPercent > 0 ? ` (%${p.discountPercent} indirim)` : ""}
                </option>
              ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">Sipariş notu</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={`${field} w-full`} />
        </label>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs text-slate-500">Teslimat adresi {order.address ? "" : <b className="text-red-600">(bu siparişte adres yok)</b>}</span>
          {saved.length > 0 && (
            <select
              value={addressId ?? ""}
              onChange={(e) => {
                const picked = saved.find((a) => a.id === Number(e.target.value));
                setAddressId(picked ? picked.id : null);
                if (picked) setAddress(picked.text);
              }}
              aria-label="Kayıtlı adreslerden seç"
              className={`${field} mb-2 w-full`}
            >
              <option value="">Kayıtlı adreslerden seç ({saved.length})</option>
              {saved.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.text.length > 90 ? `${a.text.slice(0, 90)}…` : a.text}
                  {a.hasLocation ? " 📍" : ""}
                </option>
              ))}
            </select>
          )}
          <textarea
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setAddressId(null); // elle yazıldı: yeni adres (kaydedilince müşterinin listesine eklenir)
            }}
            rows={2}
            maxLength={500}
            placeholder="Adresi yazın ya da yukarıdan kayıtlı adreslerden seçin"
            className={`${field} w-full`}
          />
          <p className="mt-1 text-xs text-slate-500">Yeni yazdığınız adres kaydedilince müşterinin kayıtlı adreslerine eklenir, sonraki siparişte seçenek olarak çıkar.</p>
        </div>
      </div>
      <button
        disabled={busy || !detailsDirty}
        onClick={() => run(() => api(base, { method: "PATCH", json: { note, address, ...(addressId !== null ? { addressId } : {}), ...(paymentTypeId !== "" ? { paymentTypeId } : {}) } }))}
        className="mt-3 rounded-lg bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-600 disabled:opacity-40"
      >
        Not / adres / ödeme kaydet
      </button>

      {order.changes.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-slate-600">Değişiklikler ({order.changes.length})</summary>
          <ul className="mt-1 space-y-1 text-xs text-slate-600">
            {order.changes.map((c) => (
              <li key={`${c.createdAt}-${c.text}`}>
                <span className="text-slate-400">{new Date(c.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span> {c.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

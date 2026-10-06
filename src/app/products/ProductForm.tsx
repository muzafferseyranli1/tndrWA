"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import ImageUploader from "@/components/ImageUploader";
import type { CategoryDto, ProductDto } from "@shared/types";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500";

export default function ProductForm({ product: initial }: { product?: ProductDto }) {
  const router = useRouter();
  const [product, setProduct] = useState<ProductDto | undefined>(initial);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [categoryId, setCategoryId] = useState<number | "">(product?.categoryId ?? "");
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<CategoryDto[]>("/api/categories")
      .then(setCategories)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function addCategory() {
    if (!newCategory.trim()) return;
    try {
      const created = await api<CategoryDto>("/api/categories", { method: "POST", json: { name: newCategory } });
      setCategories((c) => [...c, created]);
      setCategoryId(created.id);
      setNewCategory("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (categoryId === "") {
      setError("Kategori seçin.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const body = {
      name: form.get("name"),
      description: form.get("description"),
      price: form.get("price"),
      categoryId,
      status: form.get("status"),
    };
    setBusy(true);
    setError("");
    try {
      if (product) await api(`/api/products/${product.id}`, { method: "PATCH", json: body });
      else await api("/api/products", { method: "POST", json: body });
      router.push("/products");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      {product ? <ImageUploader product={product} onChange={setProduct} /> : <p className="text-xs text-slate-500">Görseli, ürünü kaydettikten sonra düzenleme sayfasından yükleyebilirsiniz.</p>}
      <label className="block text-sm">
        <span className="mb-1 block text-slate-600">Ürün adı</span>
        <input name="name" required maxLength={150} defaultValue={product?.name} className={input} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-slate-600">Açıklama</span>
        <textarea name="description" rows={3} maxLength={1000} defaultValue={product?.description} className={input} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-slate-600">Liste fiyatı (TL)</span>
        <input name="price" required inputMode="decimal" placeholder="949 veya 1.099,00" defaultValue={product ? (product.priceKurus / 100).toFixed(2).replace(".", ",") : ""} className={input} />
        <span className="mt-1 block text-xs text-slate-500">İndirimsiz liste fiyatı. Nakit/kart indirimi sipariş sırasında uygulanır.</span>
      </label>
      <div className="text-sm">
        <span className="mb-1 block text-slate-600">Kategori</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")} className={input}>
          <option value="">Seçin…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <div className="mt-2 flex gap-2">
          <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Yeni kategori adı" className={input} />
          <button type="button" onClick={addCategory} className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50">Ekle</button>
        </div>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-slate-600">Durum</span>
        <select name="status" defaultValue={product?.status ?? "ACTIVE"} className={input}>
          <option value="ACTIVE">Aktif (katalogda görünür)</option>
          <option value="PASSIVE">Pasif (katalogda görünmez)</option>
        </select>
      </label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-600 disabled:opacity-60">
          {busy ? "Kaydediliyor…" : "Kaydet"}
        </button>
        <button type="button" onClick={() => router.push("/products")} className="rounded-lg border border-slate-300 px-4 py-2 hover:bg-slate-50">Vazgeç</button>
      </div>
    </form>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import ProductForm from "../ProductForm";
import type { ProductDto } from "@shared/types";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<ProductDto | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<ProductDto>(`/api/products/${id}`)
      .then(setProduct)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold">Ürünü düzenle</h1>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {product && (
          <>
            <p className="mb-4 text-xs text-slate-500">Katalog kodu: <code>{product.retailerId}</code> (değiştirilemez)</p>
            <ProductForm product={product} />
          </>
        )}
      </main>
    </>
  );
}

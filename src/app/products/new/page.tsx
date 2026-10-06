import AppHeader from "@/components/AppHeader";
import ProductForm from "../ProductForm";

export default function NewProductPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-semibold">Yeni ürün</h1>
        <ProductForm />
      </main>
    </>
  );
}

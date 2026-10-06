import Link from "next/link";
import AppHeader from "@/components/AppHeader";

const modules = [
  { title: "Ürünler", text: "Menüyü yönet: fiyat, açıklama, aktif/pasif, bugün tükendi.", href: "/products" },
  { title: "Siparişler", text: "WhatsApp siparişleri, sesli bildirim, durum akışı.", href: null },
  { title: "Yazışma", text: "Müşterilerle panelden karşılıklı yazışma.", href: null },
];

export default function HomePage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold">Panel</h1>
        <div className="grid gap-4 sm:grid-cols-3">
          {modules.map((m) => {
            const body = (
              <>
                <h2 className="font-medium">{m.title}</h2>
                <p className="mt-1 text-sm text-slate-500">{m.text}</p>
                {!m.href && <span className="mt-3 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Yakında</span>}
              </>
            );
            return m.href ? (
              <Link key={m.title} href={m.href} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-500">
                {body}
              </Link>
            ) : (
              <section key={m.title} className="rounded-xl border border-slate-200 bg-white p-4 opacity-80">
                {body}
              </section>
            );
          })}
        </div>
      </main>
    </>
  );
}

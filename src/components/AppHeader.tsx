"use client";

import Link from "next/link";
import LogoutButton from "./LogoutButton";
import { useBrands } from "@/lib/brand";

const links = [
  { href: "/", label: "Panel" },
  { href: "/products", label: "Ürünler" },
  { href: "/brands", label: "Markalar" },
];

export default function AppHeader() {
  const { brands, brand, select } = useBrands();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <nav className="flex flex-wrap items-center gap-4">
          <span className="font-semibold text-brand-600">tndrWA</span>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm text-slate-600 hover:text-brand-600">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          {brands && brand && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Marka
              <select value={brand.id} onChange={(e) => select(Number(e.target.value))} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-medium text-slate-800">
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import LogoutButton from "./LogoutButton";
import PwaSetup from "./PwaSetup";
import { useBrands } from "@/lib/brand";

interface NavItem {
  href: string;
  label: string;
}

interface NavSection extends NavItem {
  /** Bölümün altındaki sayfalar (ikinci satırda sekme olarak görünür) */
  tabs?: NavItem[];
  /** Kasa/mutfak personeli (USER rolü) görebilir mi */
  staff?: boolean;
}

/** Üst menü: günlük işler önde, ayarlar tek bölümde. Sayfa adresleri değişmedi, yalnızca gruplandı. */
export const NAV: NavSection[] = [
  { href: "/orders", label: "Siparişler", staff: true },
  { href: "/chat", label: "Yazışma", staff: true },
  {
    href: "/products",
    label: "Ürünler",
    tabs: [
      { href: "/products", label: "Ürünler" },
      { href: "/options", label: "Seçenek grupları" },
    ],
  },
  {
    href: "/customers",
    label: "Müşteriler",
    tabs: [
      { href: "/customers", label: "Müşteri listesi" },
      { href: "/ratings", label: "Değerlendirmeler" },
    ],
  },
  { href: "/reports", label: "Raporlar" },
  {
    href: "/settings",
    label: "Ayarlar",
    tabs: [
      { href: "/settings", label: "Genel bakış" },
      { href: "/hours", label: "Saatler ve sepet" },
      { href: "/payments", label: "Ödeme şekilleri" },
      { href: "/messages", label: "Mesajlar" },
      { href: "/channels", label: "Kanallar ve QR" },
      { href: "/brands", label: "Markalar" },
      { href: "/whatsapp", label: "WhatsApp" },
      { href: "/staff", label: "Personel" },
      { href: "/business", label: "İşletme/KVKK" },
      { href: "/backups", label: "Yedekler" },
    ],
  },
];

const matches = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

export default function AppHeader() {
  const { brands, brand, select } = useBrands();
  const pathname = usePathname() ?? "";
  const [role, setRole] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { role?: string } | null) => setRole(d?.role ?? null))
      .catch(() => undefined);
  }, []);

  const sections = role === "USER" ? NAV.filter((s) => s.staff) : NAV;
  const current = sections.find((s) => matches(pathname, s.href) || s.tabs?.some((t) => matches(pathname, t.href)));
  const tabs = current?.tabs && role !== "USER" ? current.tabs : null;

  // Dar ekranda menüler yatay kayar: seçili bölüm ve sekme görünür alana gelsin
  useEffect(() => {
    headerRef.current?.querySelectorAll<HTMLElement>("[aria-current=page]").forEach((el) => el.scrollIntoView({ block: "nearest", inline: "center" }));
  }, [pathname, role]);

  return (
    <header ref={headerRef} className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <Link href="/orders" className="font-semibold text-brand-600">
          tndrWA
        </Link>
        <nav className="order-last -mx-1 flex w-full min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] sm:order-none sm:w-auto sm:flex-1" aria-label="Ana menü">
          {sections.map((s) => {
            const active = s === current;
            return (
              <Link
                key={s.href}
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-brand-600"}`}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <PwaSetup />
          <Link
            href="/help"
            aria-current={matches(pathname, "/help") ? "page" : undefined}
            title="Kullanım kılavuzu"
            className={`rounded-lg border px-2.5 py-1.5 text-sm ${matches(pathname, "/help") ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-700 hover:bg-slate-100"}`}
          >
            Yardım
          </Link>
          {brands && brand && (
            <select
              value={brand.id}
              onChange={(e) => select(Number(e.target.value))}
              aria-label="Marka"
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-800"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <LogoutButton />
        </div>
      </div>
      {tabs && (
        <div className="border-t border-slate-100 bg-slate-50/60">
          <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 py-1.5 [scrollbar-width:none]" aria-label={`${current?.label} sekmeleri`}>
            {tabs.map((t) => {
              const active = pathname === t.href || (t.href !== current?.href && matches(pathname, t.href));
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1 text-sm ${active ? "bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}

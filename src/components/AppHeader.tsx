import Link from "next/link";
import LogoutButton from "./LogoutButton";

const links = [
  { href: "/", label: "Panel" },
  { href: "/products", label: "Ürünler" },
];

export default function AppHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <nav className="flex items-center gap-4">
          <span className="font-semibold text-brand-600">tndrWA</span>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm text-slate-600 hover:text-brand-600">
              {l.label}
            </Link>
          ))}
        </nav>
        <LogoutButton />
      </div>
    </header>
  );
}

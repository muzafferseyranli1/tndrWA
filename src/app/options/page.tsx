"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";
import type { OptionChoiceDto, OptionGroupDto, ProductDto } from "@shared/types";

const field = "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500";
const btn = "rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40";
const small = "rounded border border-slate-300 px-1.5 text-[10px] leading-4 hover:bg-slate-50 disabled:opacity-30";

const priceInput = (c: OptionChoiceDto) => (c.extraKurus > 0 ? String(c.extraKurus / 100).replace(".", ",") : "");

function ChoiceRow({ c, first, last, onChange, onError }: { c: OptionChoiceDto; first: boolean; last: boolean; onChange: (g: OptionGroupDto) => void; onError: (m: string) => void }) {
  const [name, setName] = useState(c.name);
  const [price, setPrice] = useState(priceInput(c));
  const [enabled, setEnabled] = useState(c.enabled);
  const dirty = name !== c.name || price !== priceInput(c) || enabled !== c.enabled;

  const call = async (fn: () => Promise<OptionGroupDto>) => {
    try {
      onChange(await fn());
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <div className="flex flex-col gap-1">
        <button disabled={first} onClick={() => call(() => api(`/api/options/choices/${c.id}/move`, { method: "POST", json: { direction: "up" } }))} className={small} title="Yukarı">▲</button>
        <button disabled={last} onClick={() => call(() => api(`/api/options/choices/${c.id}/move`, { method: "POST", json: { direction: "down" } }))} className={small} title="Aşağı">▼</button>
      </div>
      <label className="flex items-center gap-1 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
        Açık
      </label>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} aria-label="Seçenek adı" className={`${field} min-w-36 flex-1`} />
      <label className="flex items-center gap-1 text-sm text-slate-600">
        +TL
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" inputMode="decimal" aria-label="Ekstra ücret" className={`${field} w-24`} />
      </label>
      <button disabled={!dirty} onClick={() => call(() => api(`/api/options/choices/${c.id}`, { method: "PUT", json: { name, price, enabled } }))} className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40">Kaydet</button>
      <button onClick={() => window.confirm(`"${c.name}" seçeneği silinsin mi?`) && call(() => api(`/api/options/choices/${c.id}`, { method: "DELETE" }))} className="rounded-lg border border-red-200 px-2 py-1.5 text-sm text-red-600 hover:bg-red-50">Sil</button>
    </li>
  );
}

function ProductPicker({ g, products, onChange, onError }: { g: OptionGroupDto; products: ProductDto[]; onChange: (g: OptionGroupDto) => void; onError: (m: string) => void }) {
  const [selected, setSelected] = useState<Set<number>>(new Set(g.productIds));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const byCategory = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    const map = new Map<string, ProductDto[]>();
    for (const p of products) {
      const label = p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name;
      if (q && !label.toLocaleLowerCase("tr").includes(q) && !p.categoryName.toLocaleLowerCase("tr").includes(q)) continue;
      map.set(p.categoryName, [...(map.get(p.categoryName) ?? []), p]);
    }
    return [...map.entries()];
  }, [products, query]);

  const toggle = (ids: number[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) (on ? next.add(id) : next.delete(id));
      return next;
    });

  async function save() {
    setBusy(true);
    try {
      onChange(await api<OptionGroupDto>(`/api/options/groups/${g.id}/products`, { method: "PUT", json: { productIds: [...selected] } }));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-3">
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ürün ya da kategori ara…" className={`${field} mb-2 w-full`} />
      <div className="max-h-72 space-y-3 overflow-y-auto">
        {byCategory.map(([cat, items]) => {
          const ids = items.map((p) => p.id);
          const all = ids.every((id) => selected.has(id));
          return (
            <section key={cat}>
              <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <input type="checkbox" checked={all} onChange={(e) => toggle(ids, e.target.checked)} className="h-4 w-4" />
                {cat} (tümü)
              </label>
              <ul className="ml-6 grid gap-x-4 sm:grid-cols-2">
                {items.map((p) => (
                  <li key={p.id}>
                    <label className="flex items-center gap-2 py-0.5 text-sm">
                      <input type="checkbox" checked={selected.has(p.id)} onChange={(e) => toggle([p.id], e.target.checked)} className="h-4 w-4" />
                      <span className={p.status === "PASSIVE" ? "text-slate-400" : ""}>{p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button disabled={busy} onClick={save} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">Ürün bağlantılarını kaydet ({selected.size})</button>
        <span className="text-xs text-slate-500">Porsiyonlu bir yemek seçilirse tüm porsiyonları birlikte bağlanır.</span>
      </div>
    </div>
  );
}

function GroupCard({ g, first, last, products, onChange, onDeleted, onMove, onError }: { g: OptionGroupDto; first: boolean; last: boolean; products: ProductDto[]; onChange: (g: OptionGroupDto) => void; onDeleted: () => void; onMove: (d: "up" | "down") => void; onError: (m: string) => void }) {
  const [name, setName] = useState(g.name);
  const [required, setRequired] = useState(g.required);
  const [enabled, setEnabled] = useState(g.enabled);
  const [showProducts, setShowProducts] = useState(false);
  const [newChoice, setNewChoice] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const dirty = name !== g.name || required !== g.required || enabled !== g.enabled;

  const run = async (fn: () => Promise<OptionGroupDto>) => {
    try {
      onChange(await fn());
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-col gap-1">
          <button disabled={first} onClick={() => onMove("up")} className={small} title="Yukarı">▲</button>
          <button disabled={last} onClick={() => onMove("down")} className={small} title="Aşağı">▼</button>
        </div>
        <label className="flex items-center gap-1 text-sm font-medium">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
          Açık
        </label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Soru başlığı" className={`${field} min-w-48 flex-1 font-medium`} />
        <label className="flex items-center gap-1 text-sm" title="Kapalıysa müşteriye 'Hiçbiri' seçeneği de sunulur">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-4 w-4" />
          Zorunlu
        </label>
        <button disabled={!dirty} onClick={() => run(() => api(`/api/options/groups/${g.id}`, { method: "PUT", json: { name, required, enabled } }))} className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40">Kaydet</button>
        <button onClick={async () => { if (window.confirm(`"${g.name}" grubu ve seçenekleri silinsin mi? (Eski siparişler etkilenmez.)`)) { try { await api(`/api/options/groups/${g.id}`, { method: "DELETE" }); onDeleted(); } catch (e) { onError((e as Error).message); } } }} className="rounded-lg border border-red-200 px-2 py-1.5 text-sm text-red-600 hover:bg-red-50">Sil</button>
      </div>

      <ul className="mt-2 divide-y divide-slate-100">
        {g.choices.map((c, i) => (
          <ChoiceRow key={`${c.id}-${c.name}-${c.extraKurus}-${c.enabled}`} c={c} first={i === 0} last={i === g.choices.length - 1} onChange={onChange} onError={onError} />
        ))}
      </ul>
      {g.choices.filter((c) => c.enabled).length === 0 && <p className="mt-1 text-sm text-amber-700">Açık seçenek yok: bu grup müşteriye sorulmaz.</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input value={newChoice} onChange={(e) => setNewChoice(e.target.value)} maxLength={24} placeholder="Yeni seçenek (örn. Acılı)" className={`${field} min-w-40 flex-1`} />
        <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="+TL (boş = ücretsiz)" inputMode="decimal" className={`${field} w-40`} />
        <button disabled={!newChoice.trim()} onClick={() => run(async () => { const out = await api<OptionGroupDto>(`/api/options/groups/${g.id}/choices`, { method: "POST", json: { name: newChoice, price: newPrice } }); setNewChoice(""); setNewPrice(""); return out; })} className={btn}>Seçenek ekle</button>
      </div>

      <div className="mt-3 flex items-center gap-3 text-sm">
        <span className="text-slate-600">
          <b>{g.productIds.length}</b> ürüne bağlı
        </span>
        <button onClick={() => setShowProducts((v) => !v)} className={btn}>
          {showProducts ? "Ürün listesini kapat" : "Ürünleri seç"}
        </button>
      </div>
      {showProducts && <ProductPicker key={g.productIds.join(",")} g={g} products={products} onChange={onChange} onError={onError} />}
    </li>
  );
}

export default function OptionsPage() {
  const { brand } = useBrands();
  const brandId = brand?.id;
  const [groups, setGroups] = useState<OptionGroupDto[] | null>(null);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [newRequired, setNewRequired] = useState(true);

  const load = useCallback(async () => {
    if (brandId === undefined) return;
    try {
      const [g, p] = await Promise.all([api<OptionGroupDto[]>(`/api/options?brandId=${brandId}`), api<ProductDto[]>(`/api/products?brandId=${brandId}`)]);
      setGroups(g);
      setProducts(p);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [brandId]);

  useEffect(() => {
    setGroups(null);
    void load();
  }, [load]);

  const replace = (g: OptionGroupDto) => setGroups((list) => list?.map((x) => (x.id === g.id ? g : x)) ?? null);

  async function addGroup() {
    try {
      await api("/api/options/groups", { method: "POST", json: { brandId, name: newName, required: newRequired } });
      setNewName("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function moveGroup(id: number, direction: "up" | "down") {
    try {
      await api(`/api/options/groups/${id}/move`, { method: "POST", json: { direction } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-semibold">Seçenekler{brand ? ` · ${brand.name}` : ""}</h1>
        <p className="mb-6 text-sm text-slate-500">
          Müşteri sepeti gönderdikten sonra, sepetteki ürüne bağlı gruplar WhatsApp&apos;ta tek tek sorulur (örn. <b>Acı seviyesi:</b> Acılı / Acısız, <b>Boy:</b> Büyük +20 TL). Ekstra ücretler sipariş tutarına eklenir ve %15 indirim ekstralar dahil toplam üzerinden hesaplanır.
          Seçim satır başınadır (3 dürümün hepsi aynı seçeneği alır). Bir grup birden fazla ürüne bağlanabilir.
        </p>
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!groups && !error && <p className="text-slate-500">Yükleniyor…</p>}

        <ul className="space-y-4">
          {groups?.map((g, i) => (
            <GroupCard key={g.id} g={g} first={i === 0} last={i === groups.length - 1} products={products} onChange={replace} onDeleted={() => void load()} onMove={(d) => void moveGroup(g.id, d)} onError={setError} />
          ))}
        </ul>
        {groups && groups.length === 0 && <p className="text-sm text-slate-500">Henüz grup yok. Aşağıdan ilk soruyu ekleyin.</p>}

        <section className="mt-6 rounded-xl border border-dashed border-slate-300 p-4">
          <h2 className="mb-2 font-medium">Yeni grup</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} placeholder="Soru başlığı (örn. Acı seviyesi)" className={`${field} min-w-56 flex-1`} />
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} className="h-4 w-4" />
              Zorunlu
            </label>
            <button disabled={!newName.trim()} onClick={addGroup} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40">Grup ekle</button>
          </div>
        </section>
      </main>
    </>
  );
}

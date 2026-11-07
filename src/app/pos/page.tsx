"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";

interface Issue {
  productId: number;
  product: string;
  kind: "noProduct" | "noVariant" | "requiredMissing" | "groupNotInPos" | "choiceNotInPos" | "tooManyChoices";
  detail: string;
  posGroup?: { name: string; min: number; max: number; choices: number };
}

interface PosStatus {
  tokenSet: boolean;
  posCafeId: string | null;
  customers: { read: number; noPhone: number; created: number; existing: number; namesFilled: number; addressesAdded: number; at: string; batch: number; of: number } | null;
  report: { snapshotAt: string | null; cafeName: string; posProducts: number; checked: number; ok: number; issues: Issue[] };
}

const KINDS: { kind: Issue["kind"]; title: string; hint: string; tone: string }[] = [
  { kind: "requiredMissing", title: "POS'ta zorunlu, WhatsApp'ta sorulmuyor", hint: "Bu ürünler POS'a eksik yazılır. \"WhatsApp'a ekle\" grubu POS'taki seçenekleriyle kurar ve ürüne bağlar.", tone: "border-red-200 bg-red-50" },
  { kind: "tooManyChoices", title: "WhatsApp listesine sığmayan gruplar", hint: "WhatsApp listesi en fazla 9 seçenek gösterebiliyor; bu gruplar için sayfalı liste gerekiyor.", tone: "border-red-200 bg-red-50" },
  { kind: "noProduct", title: "POS'ta bulunamayan ürünler", hint: "Adı POS'takiyle aynı olmayan ürünler. POS'a yazılırken personel elle ekler.", tone: "border-amber-200 bg-amber-50" },
  { kind: "noVariant", title: "POS'ta bulunamayan porsiyonlar", hint: "Ürün var ama porsiyon adı eşleşmiyor.", tone: "border-amber-200 bg-amber-50" },
  { kind: "groupNotInPos", title: "WhatsApp'ta sorulan ama POS'ta olmayan seçenekler", hint: "Müşterinin cevabı POS'a ürün notu olarak yazılır.", tone: "border-slate-200 bg-slate-50" },
  { kind: "choiceNotInPos", title: "POS'ta bulunamayan seçimler", hint: "Bu seçimler POS'a ürün notu olarak yazılır.", tone: "border-slate-200 bg-slate-50" },
];

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-");

export default function PosPage() {
  const { brand } = useBrands();
  const brandId = brand?.id;
  const [status, setStatus] = useState<PosStatus | null>(null);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (brandId === undefined) return;
    try {
      setStatus(await api<PosStatus>(`/api/pos?brandId=${brandId}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [brandId]);

  useEffect(() => {
    setStatus(null);
    void load();
  }, [load]);

  async function makeToken() {
    if (status?.tokenSet && !confirm("Yeni anahtar oluşturulursa eklentideki eski anahtar çalışmaz; eklentiye yenisini girmeniz gerekir. Devam edilsin mi?")) return;
    setBusy("token");
    try {
      setToken((await api<{ token: string }>("/api/pos/token", { method: "POST", json: {} })).token);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function unlink() {
    if (!confirm("Bu markanın POS şubesi bağlantısı kaldırılsın mı? Eklenti bu şubede yeniden marka seçtirir.")) return;
    await api(`/api/pos/link?brandId=${brandId}`, { method: "DELETE" });
    await load();
  }

  async function applyGroup(issue: Issue) {
    if (!issue.posGroup) return;
    setBusy(`${issue.productId}:${issue.posGroup.name}`);
    setMsg("");
    try {
      const out = await api<{ created: boolean; linked: number; report: PosStatus["report"] }>("/api/pos/apply-group", { method: "POST", json: { brandId, productId: issue.productId, posGroup: issue.posGroup.name } });
      setStatus((s) => (s ? { ...s, report: out.report } : s));
      setMsg(`"${issue.posGroup.name}" ${out.created ? "oluşturuldu ve" : ""} ${out.linked} ürüne bağlandı. Seçenekler sayfasından metinleri düzenleyebilirsiniz.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const r = status?.report;
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-semibold">POS bağlantısı{brand ? ` · ${brand.name}` : ""}</h1>
        <p className="mb-6 text-sm text-slate-500">Suitable POS eklentisi POS&apos;tan menüyü ve müşterileri okur, WhatsApp siparişlerini POS&apos;un Paket ekranına doldurur; &quot;Sipariş Oluştur&quot;a personel basar.</p>
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!status && !error && <p className="text-slate-500">Yükleniyor…</p>}
        {status && (
          <div className="space-y-6">
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-medium">Eklenti</h2>
              <p className="mb-3 text-sm text-slate-500">
                Anahtar: {status.tokenSet ? <b className="text-green-700">tanımlı</b> : <b className="text-red-700">yok</b>}. Anahtar yalnız oluşturulduğunda bir kez gösterilir.
              </p>
              <button disabled={busy === "token"} onClick={makeToken} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
                {status.tokenSet ? "Yeni anahtar oluştur" : "Anahtar oluştur"}
              </button>
              {token && (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
                  <p className="mb-1 font-medium text-green-900">Bu anahtarı eklentinin ayarlarına girin (bir daha gösterilmez):</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="break-all rounded bg-white px-2 py-1">{token}</code>
                    <button onClick={() => navigator.clipboard?.writeText(token)} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50">
                      Kopyala
                    </button>
                  </div>
                </div>
              )}
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
                <li>Chrome&apos;da <code>chrome://extensions</code> adresini açın, sağ üstten <b>Geliştirici modu</b>nu açın.</li>
                <li>
                  <b>Paketlenmemiş öğe yükle</b> ile proje klasöründeki <code>pos-extension</code> klasörünü seçin.
                </li>
                <li>Eklentinin <b>Seçenekler</b> sayfasına panel adresini ({typeof window !== "undefined" ? window.location.origin : ""}) ve anahtarı girin.</li>
                <li>POS&apos;ta sağ alttaki <b>tndrWA</b> düğmesinden markayı seçip &quot;Menüyü gönder&quot;e basın.</li>
              </ol>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-medium">POS şubesi</h2>
              {status.posCafeId ? (
                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                  <span>
                    Bağlı: <b>{r?.cafeName || "POS şubesi"}</b> · son menü: {when(r?.snapshotAt)} · POS&apos;ta {r?.posProducts ?? 0} ürün
                  </span>
                  <button onClick={unlink} className="rounded-lg border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">
                    Bağlantıyı kaldır
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-sm text-slate-500">Henüz bağlı değil. Eklentiden bu markayı seçip menüyü gönderince bağlanır.</p>
              )}
              {status.customers && (
                <p className="mt-2 text-sm text-slate-600">
                  Son müşteri eşitleme {when(status.customers.at)}: {status.customers.read} okundu, {status.customers.created} yeni, {status.customers.addressesAdded} yeni adres, {status.customers.namesFilled} ad tamamlandı
                  {status.customers.noPhone ? `, ${status.customers.noPhone} telefonsuz atlandı` : ""}
                  {status.customers.batch < status.customers.of ? ` (${status.customers.batch}/${status.customers.of} parça, sürüyor)` : ""}.
                </p>
              )}
            </section>

            {r?.snapshotAt && (
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="font-medium">Eşleşme raporu</h2>
                <p className="mb-3 text-sm text-slate-500">
                  WhatsApp&apos;taki {r.checked} aktif ürünün {r.ok} tanesi POS&apos;a sorunsuz yazılabilir.
                </p>
                {msg && <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{msg}</p>}
                <div className="space-y-4">
                  {KINDS.map((k) => {
                    const items = r.issues.filter((i) => i.kind === k.kind);
                    if (!items.length) return null;
                    return (
                      <div key={k.kind} className={`rounded-lg border p-3 ${k.tone}`}>
                        <h3 className="text-sm font-medium">
                          {k.title} ({items.length})
                        </h3>
                        <p className="mb-2 text-xs text-slate-600">{k.hint}</p>
                        <ul className="space-y-1 text-sm">
                          {items.map((i, n) => (
                            <li key={`${i.productId}-${n}`} className="flex flex-wrap items-center gap-2">
                              <b>{i.product}</b>
                              <span className="text-slate-600">{i.detail}</span>
                              {i.kind === "requiredMissing" && i.posGroup && (
                                <button
                                  disabled={busy === `${i.productId}:${i.posGroup.name}`}
                                  onClick={() => applyGroup(i)}
                                  className="ml-auto rounded-lg bg-brand-500 px-3 py-1 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                                >
                                  WhatsApp&apos;a ekle
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </>
  );
}

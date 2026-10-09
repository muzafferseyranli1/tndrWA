"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import type { BusinessSettingsDto, DeletionRequestDto } from "@shared/types";

const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500";

export default function BusinessPage() {
  const [data, setData] = useState<BusinessSettingsDto | null>(null);
  const [info, setInfo] = useState({ legalName: "", address: "", email: "", phone: "", verbis: "" });
  const [ret, setRet] = useState({ messagesDays: "90", ordersDays: "730", ratingsDays: "730" });
  const [requests, setRequests] = useState<DeletionRequestDto[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api<BusinessSettingsDto>("/api/business"), api<DeletionRequestDto[]>("/api/business/deletion-requests?status=all")]);
      setData(s);
      setInfo(s.info);
      setRet({ messagesDays: String(s.retention.messagesDays), ordersDays: String(s.retention.ordersDays), ratingsDays: String(s.retention.ratingsDays) });
      setRequests(r);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/business", { method: "PUT", json: { info, retention: { messagesDays: Number(ret.messagesDays), ordersDays: Number(ret.ordersDays), ratingsDays: Number(ret.ratingsDays) } } });
      setMsg({ ok: true, text: "Kaydedildi." });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function process(r: DeletionRequestDto, action: "erase" | "reject") {
    if (action === "erase" && !window.confirm(`+${r.phone} numarasına ait yazışma, adres ve kişisel bilgiler KALICI olarak silinsin mi? Bu işlem geri alınamaz.`)) return;
    try {
      await api(`/api/business/deletion-requests/${r.id}/process`, { method: "POST", json: { action } });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  const pending = requests.filter((r) => r.status === "PENDING");

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-semibold">İşletme / KVKK</h1>
        <p className="mb-6 text-sm text-slate-500">
          Gizlilik ve aydınlatma metni bu bilgilerden otomatik oluşur. Ünvan, adres, e-posta ve telefon dolu değilse sayfalar yayımlanmaz (&quot;hazırlanıyor&quot; görünür). Metin hazır bir şablondur, yayımlamadan önce hukuk danışmanınıza göstermeniz önerilir.
        </p>
        {msg && <p role="alert" className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

        {data?.provisional && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Ünvan ve adres şu an <b>geçici</b> (fişten alınan kısaltmalı bilgiler). Vergi levhasındaki tam ünvan ve resmî adresi girip Kaydet&apos;e basın, Meta uygulamasını Live yapmadan ve gerçek müşteriye açmadan önce mutlaka güncelleyin.
          </p>
        )}
        {data && (
          <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${data.ready ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}>
            {data.ready ? "Gizlilik sayfaları yayında." : "Eksik bilgi var: sayfalar henüz yayımlanmıyor."}
          </p>
        )}

        <section className="mb-6 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-medium">İşletme bilgileri</h2>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Ticari ünvan (vergi levhasındaki gibi, kısaltmasız)</span>
            <input value={info.legalName} onChange={(e) => setInfo({ ...info, legalName: e.target.value })} maxLength={200} className={field} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Resmî adres</span>
            <textarea value={info.address} onChange={(e) => setInfo({ ...info, address: e.target.value })} rows={2} maxLength={400} className={field} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">E-posta</span>
              <input value={info.email} onChange={(e) => setInfo({ ...info, email: e.target.value })} maxLength={120} className={field} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Telefon</span>
              <input value={info.phone} onChange={(e) => setInfo({ ...info, phone: e.target.value })} maxLength={40} className={field} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">VERBIS sicil numarası (varsa)</span>
            <input value={info.verbis} onChange={(e) => setInfo({ ...info, verbis: e.target.value })} maxLength={60} className={field} />
          </label>
        </section>

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 font-medium">Saklama süreleri (gün)</h2>
          <p className="mb-3 text-sm text-slate-500">Süresi dolan kayıtlar her saat otomatik silinir. Açık (teslim edilmemiş) siparişler hiçbir zaman silinmez.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {([
              ["messagesDays", "Yazışmalar"],
              ["ordersDays", "Tamamlanan siparişler"],
              ["ratingsDays", "Değerlendirmeler"],
            ] as const).map(([k, label]) => (
              <label key={k} className="block text-sm">
                <span className="mb-1 block text-slate-600">{label}</span>
                <input type="number" min={7} value={ret[k]} onChange={(e) => setRet({ ...ret, [k]: e.target.value })} className={field} />
              </label>
            ))}
          </div>
        </section>

        <button disabled={busy} onClick={save} className="mb-8 rounded-lg bg-brand-500 px-5 py-2.5 font-medium text-white hover:bg-brand-600 disabled:opacity-50">
          {busy ? "Kaydediliyor…" : "Kaydet"}
        </button>

        {data && (
          <section className="mb-8 rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <h2 className="mb-2 font-medium">Meta uygulamasına girilecek bağlantılar</h2>
            <p className="mb-2 text-slate-600">Uygulamayı Live yaparken (Ayarlar → Temel) istenen alanlar:</p>
            <ul className="space-y-1">
              <li>Gizlilik politikası URL&apos;si: <code className="break-all">{data.policyUrl}</code></li>
              <li>Veri silme talimatları URL&apos;si: <code className="break-all">{data.deletionUrl}</code></li>
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-2 font-medium">Veri silme talepleri {pending.length > 0 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{pending.length}</span>}</h2>
          {requests.length === 0 && <p className="text-sm text-slate-500">Henüz talep yok.</p>}
          <ul className="space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <b>+{r.phone}</b>
                  <span className="text-xs text-slate-500">{new Date(r.createdAt).toLocaleString("tr-TR")}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${r.status === "PENDING" ? "bg-red-100 text-red-700" : r.status === "DONE" ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-600"}`}>
                    {r.status === "PENDING" ? "Bekliyor" : r.status === "DONE" ? "Silindi" : "Reddedildi"}
                  </span>
                  <span className="ml-auto text-xs text-slate-500">{r.matchingCustomers} kayıtlı müşteri eşleşiyor</span>
                </div>
                {r.note && <p className="mt-1 text-slate-700">{r.note}</p>}
                {r.handledNote && <p className="mt-1 text-xs text-slate-500">{r.handledNote}</p>}
                {r.status === "PENDING" && (
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => process(r, "erase")} className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700">Sil ve tamamla</button>
                    <button onClick={() => process(r, "reject")} className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">Reddet</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

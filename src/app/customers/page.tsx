"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import type { CustomerDto, CustomerImportJobDto } from "@shared/types";

const PAGE = 50;

export default function CustomersPage() {
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; items: CustomerDto[] } | null>(null);
  const [error, setError] = useState("");
  const [job, setJob] = useState<CustomerImportJobDto | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<{ total: number; items: CustomerDto[] }>(`/api/customers?q=${encodeURIComponent(q)}&limit=${PAGE}&offset=${offset}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [q, offset]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  // İçe aktarma sürerken ilerlemeyi sorgula
  useEffect(() => {
    if (!job || job.state !== "running") return;
    const t = setInterval(async () => {
      try {
        const j = await api<CustomerImportJobDto>(`/api/customers/import/${job.id}`);
        setJob(j);
        if (j.state !== "running") void load();
      } catch (e) {
        setError((e as Error).message);
      }
    }, 1500);
    return () => clearInterval(t);
  }, [job, load]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/customers/import", { method: "POST", body });
      const out = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
      if (!res.ok || !out.jobId) throw new Error(out.error ?? "Dosya yüklenemedi.");
      setJob(await api<CustomerImportJobDto>(`/api/customers/import/${out.jobId}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const s = job?.stats;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-semibold">Müşteriler</h1>
        <p className="mb-6 text-sm text-slate-500">
          Müşteriler telefon numarasına göre kayıtlıdır ve tüm markalarda ortaktır. Kayıtlı adresi olan müşteriye sipariş sırasında adresi sorulur.
        </p>
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 font-medium">Excel&apos;den içe aktar</h2>
          <p className="mb-3 text-sm text-slate-600">
            .xlsx dosyasının ilk sayfası okunur; ilk satır başlık olmalı. Aranan sütunlar: <b>Ad Soyad</b>, <b>Telefon</b>, <b>Mahalle</b>, <b>Adres</b>. Telefona göre eşleştirilir; var olan müşterinin dolu bilgisinin üzerine yazılmaz,
            eksik adı doldurulur ve adresi listesine eklenir. Bozuk telefonlu satırlar atlanır. Dosya sunucuya kaydedilmez.
          </p>
          <input ref={fileInput} type="file" accept=".xlsx" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
          <button disabled={uploading || job?.state === "running"} onClick={() => fileInput.current?.click()} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
            {uploading ? "Yükleniyor…" : job?.state === "running" ? "İçe aktarılıyor…" : "Excel dosyası seç"}
          </button>

          {job && s && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="mb-1 font-medium">
                {job.fileName} ·{" "}
                {job.state === "running" ? "sürüyor…" : job.state === "done" ? "tamamlandı" : <span className="text-red-600">başarısız: {job.error}</span>}
              </p>
              <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <li>Okunan satır: <b>{s.read}</b></li>
                <li>Yeni müşteri: <b>{s.created}</b></li>
                <li>Zaten kayıtlı: <b>{s.existing}</b> (adı doldurulan: {s.namesFilled})</li>
                <li>Eklenen adres: <b>{s.addressesAdded}</b></li>
                <li>Adresi olmayan: <b>{s.withoutAddress}</b></li>
                <li>Atlanan (bozuk telefon): <b>{s.invalidPhone}</b></li>
                <li>Atlanan (dosyada tekrar): <b>{s.duplicateInFile}</b></li>
              </ul>
            </div>
          )}
        </section>

        <input
          value={q}
          onChange={(e) => {
            setOffset(0);
            setQ(e.target.value);
          }}
          placeholder="Ad ya da telefon ara…"
          className="mb-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-brand-500"
        />
        {!data && !error && <p className="text-slate-500">Yükleniyor…</p>}
        {data && (
          <>
            <p className="mb-2 text-sm text-slate-500">{data.total} müşteri</p>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {data.items.map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">{c.name ?? "İsimsiz"}</span>
                    {c.phone && <span className="text-sm text-slate-600">+{c.phone}</span>}
                    <span className="ml-auto text-xs text-slate-500">
                      {c.orderCount} sipariş · {c.addressCount} adres
                    </span>
                  </div>
                  {c.lastAddress && <p className="mt-1 truncate text-sm text-slate-500">{c.lastAddress}</p>}
                </li>
              ))}
              {data.items.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Kayıt bulunamadı.</li>}
            </ul>
            <div className="mt-3 flex items-center justify-between">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40">← Önceki</button>
              <span className="text-sm text-slate-500">
                {data.total === 0 ? 0 : offset + 1}-{Math.min(offset + PAGE, data.total)}
              </span>
              <button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40">Sonraki →</button>
            </div>
          </>
        )}
      </main>
    </>
  );
}

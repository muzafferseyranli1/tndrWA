"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import type { StaffUserDto } from "@shared/types";

const field = "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500";

export default function StaffPage() {
  const [data, setData] = useState<{ owner: string; users: StaffUserDto[] } | null>(null);
  const [form, setForm] = useState({ username: "", password: "", role: "USER" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<{ owner: string; users: StaffUserDto[] }>("/api/staff"));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      setMsg({ ok: true, text: ok });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(u: StaffUserDto) {
    const next = window.prompt(`${u.username} için yeni şifre (en az 8 karakter):`);
    if (!next) return;
    await run(() => api(`/api/staff/${u.id}`, { method: "PATCH", json: { password: next } }), "Şifre değiştirildi.");
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-semibold">Personel</h1>
        <p className="mb-4 text-sm text-slate-600">
          <b>Kullanıcı</b> rolü yalnızca Siparişler ve Yazışma sayfalarını kullanır (ürünü &quot;bugün tükendi&quot; yapabilir). <b>Yönetici</b> her şeyi görür. Ana yönetici ({data?.owner ?? "…"}) sunucu ayarından gelir, buradan silinemez.
        </p>
        {msg && <p role="alert" className={`mb-4 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-medium">Yeni personel</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Kullanıcı adı</span>
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" className={field} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Şifre</span>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" className={field} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Rol</span>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={field}>
                <option value="USER">Kullanıcı (sipariş + yazışma)</option>
                <option value="ADMIN">Yönetici</option>
              </select>
            </label>
            <button
              disabled={busy || !form.username || !form.password}
              onClick={() => run(async () => { await api("/api/staff", { method: "POST", json: form }); setForm({ username: "", password: "", role: "USER" }); }, "Personel eklendi.")}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-40"
            >
              Ekle
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white">
          {data && data.users.length === 0 && <p className="p-4 text-sm text-slate-500">Henüz personel yok.</p>}
          <ul className="divide-y divide-slate-100">
            {data?.users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-32 flex-1 font-medium">
                  {u.username}
                  {!u.active && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-normal text-slate-700">pasif</span>}
                </span>
                <select
                  value={u.role}
                  disabled={busy}
                  onChange={(e) => run(() => api(`/api/staff/${u.id}`, { method: "PATCH", json: { role: e.target.value } }), "Rol değişti.")}
                  className={field}
                  aria-label={`${u.username} rolü`}
                >
                  <option value="USER">Kullanıcı</option>
                  <option value="ADMIN">Yönetici</option>
                </select>
                <button disabled={busy} onClick={() => resetPassword(u)} className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
                  Şifre değiştir
                </button>
                <button disabled={busy} onClick={() => run(() => api(`/api/staff/${u.id}`, { method: "PATCH", json: { active: !u.active } }), u.active ? "Hesap kapatıldı." : "Hesap açıldı.")} className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
                  {u.active ? "Kapat" : "Aç"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => window.confirm(`${u.username} silinsin mi?`) && run(() => api(`/api/staff/${u.id}`, { method: "DELETE" }), "Silindi.")}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-red-600 hover:bg-red-50"
                >
                  Sil
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

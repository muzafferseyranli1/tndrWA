"use client";

import { useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      if (res.ok) {
        window.location.href = "/panel";
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Giriş yapılamadı.");
    } catch {
      setError("Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-brand-600">tndrWA Panel</h1>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Kullanıcı adı</span>
          <input name="username" autoComplete="username" required className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Şifre</span>
          <input name="password" type="password" autoComplete="current-password" required className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500" />
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-600 disabled:opacity-60">
          {busy ? "Giriş yapılıyor…" : "Giriş yap"}
        </button>
      </form>
    </main>
  );
}

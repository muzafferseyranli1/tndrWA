"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";
import type { BackupDto, BusinessSettingsDto } from "@shared/types";

interface Card {
  href: string;
  title: string;
  text: string;
  /** Kısa canlı durum (varsa) */
  hint?: string;
  warn?: boolean;
}

const when = (iso: string) => new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Ayarlar bölümünün giriş sayfası: tüm ayar sayfaları gruplu, kısa durum bilgisiyle. */
export default function SettingsPage() {
  const { brand } = useBrands();
  const brandId = brand?.id;
  const [hours, setHours] = useState<{ state: string; summary: string; nextOpening: string; minBasketKurus: number; hours: { enabled: boolean } } | null>(null);
  const [business, setBusiness] = useState<BusinessSettingsDto | null>(null);
  const [backup, setBackup] = useState<BackupDto | null>(null);
  const [staffCount, setStaffCount] = useState<number | null>(null);

  useEffect(() => {
    if (brandId === undefined) return;
    api<typeof hours>(`/api/hours?brandId=${brandId}`).then(setHours).catch(() => undefined);
  }, [brandId]);

  useEffect(() => {
    api<BusinessSettingsDto>("/api/business").then(setBusiness).catch(() => undefined);
    api<BackupDto>("/api/backups").then(setBackup).catch(() => undefined);
    api<{ users: unknown[] }>("/api/staff").then((d) => setStaffCount(d.users.length)).catch(() => undefined);
  }, []);

  const hoursHint = hours ? (!hours.hours.enabled ? "Saat kontrolü kapalı" : `${hours.summary} · şu an ${hours.state === "open" ? "açık" : hours.state === "pre" ? "açılışa az kaldı" : "kapalı"}`) : undefined;

  const groups: { title: string; cards: Card[] }[] = [
    {
      title: "Satış",
      cards: [
        { href: "/hours", title: "Saatler ve sepet", text: "Çalışma saatleri, kapalıyken davranış, minimum sepet tutarı.", hint: hoursHint },
        { href: "/payments", title: "Ödeme şekilleri", text: "Nakit, kapıda kart vb. ve indirim oranları." },
      ],
    },
    {
      title: "Müşteri iletişimi",
      cards: [
        { href: "/messages", title: "Mesajlar", text: "Müşteriye giden otomatik mesaj metinleri, katalog mesajı görseli." },
        { href: "/channels", title: "Kanallar ve QR", text: "QR açılış sayfasındaki düğmeler, sipariş kanalları ve QR kodları." },
      ],
    },
    {
      title: "Bağlantılar",
      cards: [
        { href: "/brands", title: "Markalar", text: "Marka başına Meta katalog kimliği ve WhatsApp numara kimliği." },
        { href: "/whatsapp", title: "WhatsApp", text: "WhatsApp bağlantı durumu, deneme mesajı, son olaylar." },
      ],
    },
    {
      title: "Yönetim",
      cards: [
        { href: "/staff", title: "Personel", text: "Panel kullanıcıları ve yetkileri (Yönetici / Kullanıcı).", hint: staffCount === null ? undefined : `${staffCount} personel hesabı` },
        {
          href: "/business",
          title: "İşletme ve KVKK",
          text: "Ünvan, adres, saklama süreleri, veri silme talepleri.",
          hint: business?.provisional ? "Ünvan ve adres geçici, vergi levhasındakiyle güncelleyin" : business ? "Bilgiler tamam" : undefined,
          warn: !!business?.provisional,
        },
        {
          href: "/backups",
          title: "Yedekler",
          text: "Günlük otomatik yedek, elle yedek alma ve indirme.",
          hint: backup ? (backup.lastError ? `Son yedek hatalı: ${backup.lastError}` : backup.lastRunAt ? `Son yedek ${when(backup.lastRunAt)}` : "Henüz yedek yok") : undefined,
          warn: !!backup?.lastError,
        },
      ],
    },
  ];

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-semibold">Ayarlar</h1>
        <p className="mb-6 text-sm text-slate-500">Marka seçimi sağ üstte. Saatler, ödeme, mesajlar ve kanallar seçili markaya göre ayrıdır.</p>
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.title}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.cards.map((c) => (
                  <Link key={c.href} href={c.href} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-500">
                    <div className="font-medium">{c.title}</div>
                    <p className="mt-1 text-sm text-slate-500">{c.text}</p>
                    {c.hint && <p className={`mt-2 text-xs ${c.warn ? "font-medium text-amber-700" : "text-brand-700"}`}>{c.hint}</p>}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}

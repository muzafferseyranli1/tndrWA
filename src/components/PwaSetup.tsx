"use client";

import { useEffect } from "react";
import { useInstallPrompt } from "@/lib/pwa";

/**
 * Panel sayfalarını uygulama olarak kurulabilir yapar: manifest bağlantısı (yalnızca panelde; müşterinin açtığı sayfalar kurulum önermesin),
 * service worker kaydı ve tarayıcı izin verdiğinde "Uygulamayı yükle" düğmesi.
 */
export default function PwaSetup() {
  const { canInstall, install } = useInstallPrompt();

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  return (
    <>
      <link rel="manifest" href="/manifest.webmanifest" />
      <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      <meta name="theme-color" content="#1f6b46" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="Yerinde Panel" />
      {canInstall && (
        <button onClick={() => void install()} className="whitespace-nowrap rounded-lg border border-brand-500 px-2.5 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50" title="Paneli bu cihaza uygulama olarak kur">
          📲 Uygulamayı yükle
        </button>
      )}
    </>
  );
}

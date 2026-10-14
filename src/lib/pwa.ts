"use client";

import { useCallback, useEffect, useState } from "react";

/** Panel ana ekrana kurulmuş uygulama olarak mı açıldı (adres çubuğu yok). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Android/masaüstü Chrome'un "uygulamayı yükle" penceresi; iPad/iPhone'da yok (Paylaş → Ana Ekrana Ekle). */
export function useInstallPrompt() {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!event) return;
    await event.prompt();
    await event.userChoice.catch(() => undefined);
    setEvent(null);
  }, [event]);

  return { canInstall: !!event && !installed, installed, install };
}

/** Ekranın kararıp kilitlenmesini engeller (sekme görünürken). Sekmeden çıkınca tarayıcı bırakır, geri gelince yeniden alınır. */
export function useWakeLock(enabled: boolean) {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    setSupported("wakeLock" in navigator);
  }, []);

  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let stopped = false;

    const acquire = async () => {
      if (stopped || sentinel || document.visibilityState !== "visible") return;
      try {
        const s = await navigator.wakeLock.request("screen");
        if (stopped) {
          void s.release();
          return;
        }
        sentinel = s;
        setActive(true);
        s.addEventListener("release", () => {
          sentinel = null;
          setActive(false);
        });
      } catch {
        setActive(false);
      }
    };

    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release();
      sentinel = null;
      setActive(false);
    };
  }, [enabled]);

  return { supported, active };
}

/** Bu cihazda hatırlanan açık/kapalı tercihi (ses, ekran açık tut vb.). Depolama kapalıysa varsayılan kullanılır. */
export function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* depolama kapalıysa tercih yalnızca bu açılışta geçerli */
  }
}

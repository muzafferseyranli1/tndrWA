"use client";

import { useEffect, useState } from "react";

/**
 * POS'a yazma yöntemi: "api" iken indirimi ve fiyatı POS belirler (panelde girilen ödeme indirimi ve liste fiyatı bu yöntemde işlevsizdir).
 * Yüklenene kadar ya da sorgu başarısızsa null (uyarı gösterilmez).
 */
export function useWriteMode(): "api" | "extension" | null {
  const [mode, setMode] = useState<"api" | "extension" | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/pos/mode")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { writeMode?: string } | null) => {
        if (alive && (d?.writeMode === "api" || d?.writeMode === "extension")) setMode(d.writeMode);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return mode;
}

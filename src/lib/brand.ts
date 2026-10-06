"use client";

import { useCallback, useEffect, useState } from "react";
import type { BrandDto } from "@shared/types";
import { api } from "./api";

const KEY = "tndrwa_brand";
const EVENT = "tndrwa-brand";

function readStored(): number | null {
  try {
    const v = Number(window.localStorage.getItem(KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Marka listesi ve seçili marka. Seçim tarayıcıda hatırlanır ve sayfalar arasında paylaşılır. */
export function useBrands() {
  const [brands, setBrands] = useState<BrandDto[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setBrands(await api<BrandDto[]>("/api/brands"));
  }, []);

  useEffect(() => {
    void reload().catch(() => undefined);
    setSelectedId(readStored());
    const onChange = () => setSelectedId(readStored());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [reload]);

  const brand = brands?.find((b) => b.id === selectedId) ?? brands?.[0] ?? null;

  const select = useCallback((id: number) => {
    try {
      window.localStorage.setItem(KEY, String(id));
    } catch {
      /* tarayıcı depolaması kapalıysa seçim yalnızca bu sayfada geçerli olur */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { brands, brand, select, reload };
}

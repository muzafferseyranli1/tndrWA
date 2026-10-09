import express, { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { resolveBrand } from "../services/brands";
import { DEFAULT_TEMPLATES, MESSAGE_KEYS, templateKey, templateFor, type MessageKey } from "../services/order-messages";

const ALL = "{ad}, {no}, {toplam}, {indirim}, {tutar}, {odeme}, {adres} kullanılabilir.";
const KVKK = " {kvkk} ilk temasta müşteriye aydınlatma metni bağlantısını koyar (daha önce gönderildiyse boş kalır).";
const DELIVERED_HINT = "Durum Teslim edildi olunca gider. {degerlendirme} sipariş için tek kullanımlık değerlendirme bağlantısını koyar. " + ALL;
const LABELS: Record<MessageKey, { label: string; hint: string }> = {
  WELCOME: { label: "Hoş geldin", hint: "Müşteri ilk yazdığında katalog düğmesiyle gider. {ad} kullanılabilir." + KVKK },
  NEW: { label: "Sipariş alındı + ödeme sorusu", hint: "Sepet geldiğinde gider, altında ödeme seçim listesi çıkar. " + ALL + KVKK },
  ASK_ADDRESS: { label: "Adres isteme", hint: "Ödeme seçilince gider. Müşteri adresi yazar ya da konum atar." },
  CONFIRM_ADDRESS: { label: "Kayıtlı adres onayı", hint: "Müşterinin kayıtlı adresi varsa gider; altında Evet / Yeni adres düğmeleri çıkar. {adres} kullanılabilir." },
  CHOOSE_ADDRESS: { label: "Adres seçimi (birden fazla kayıtlı adres)", hint: "Müşterinin birden fazla kayıtlı adresi varsa gider; altında adres listesi çıkar." },
  CONFIRMED: { label: "Sipariş onayı", hint: "Ödeme ve adres tamamlanınca gider, sipariş panelde yeni olur. " + ALL },
  ORDER_UPDATED: { label: "Sipariş güncellendi", hint: "Personel siparişi düzenleyip \"Müşteriye güncel özeti gönder\"e basınca gider. {urunler} güncel ürün listesidir. " + ALL },
  PREPARING: { label: "Hazırlanıyor", hint: "Durum Hazırlanıyor olunca gider. " + ALL },
  ON_THE_WAY: { label: "Yola çıktı", hint: "Durum Yola çıktı olunca gider. " + ALL },
  DELIVERED: { label: "Teslim edildi", hint: DELIVERED_HINT },
  CANCELLED: { label: "İptal edildi", hint: "Sipariş iptal edilince gider. " + ALL },
};

export const MAX_MESSAGE_LENGTH = 1000;

/** Markaya göre müşteri mesaj metinleri (durum bildirimleri, hoş geldin). Boş kaydedilen metin varsayılana döner. */
export function messagesRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(express.json({ limit: "10kb" }));

  router.get("/", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const items = [];
    for (const key of MESSAGE_KEYS) {
      const text = await templateFor(db, brand.code, key);
      items.push({ key, ...LABELS[key], text, defaultText: DEFAULT_TEMPLATES[key], isDefault: text === DEFAULT_TEMPLATES[key] });
    }
    res.json(items);
  });

  router.put("/:key", async (req, res) => {
    const key = req.params.key as MessageKey;
    if (!MESSAGE_KEYS.includes(key)) return res.status(404).json({ error: "Bilinmeyen mesaj." });
    const parsed = z.object({ brandId: z.number().int().optional(), text: z.string().max(MAX_MESSAGE_LENGTH, `Mesaj en fazla ${MAX_MESSAGE_LENGTH} karakter olabilir.`) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz istek." });
    const brand = await resolveBrand(db, parsed.data.brandId === undefined ? undefined : String(parsed.data.brandId));
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });

    const text = parsed.data.text.trim();
    const storeKey = templateKey(brand.code, key);
    if (!text || text === DEFAULT_TEMPLATES[key]) await db.setting.deleteMany({ where: { key: storeKey } });
    else await db.setting.upsert({ where: { key: storeKey }, create: { key: storeKey, value: text }, update: { value: text } });
    const current = await templateFor(db, brand.code, key);
    res.json({ key, ...LABELS[key], text: current, defaultText: DEFAULT_TEMPLATES[key], isDefault: current === DEFAULT_TEMPLATES[key] });
  });

  return router;
}

import express, { Router } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import type { BrandChannel, PrismaClient } from "@prisma/client";
import { CHANNEL_SPECS, isChannelKind, validateChannelValue } from "../../shared/channels";
import type { ChannelDto, ChannelStatsDto } from "../../shared/types";
import { resolveBrand } from "../services/brands";
import { moveInOrder } from "./products";

const toDto = (c: BrandChannel): ChannelDto | null => {
  if (!isChannelKind(c.kind)) return null;
  const spec = CHANNEL_SPECS.find((s) => s.kind === c.kind)!;
  return { id: c.id, kind: c.kind, label: c.label, value: c.value, enabled: c.enabled, valueHint: spec.valueHint, valueType: spec.valueType };
};

/** Panel: marka kanallarının düzenlenmesi, sayaçlar ve QR kodları. Giriş gerektirir. */
export function channelsRouter(db: PrismaClient, publicBaseUrl: string | null): Router {
  const router = Router();
  router.use(express.json({ limit: "5kb" }));

  router.get("/", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const rows = await db.brandChannel.findMany({ where: { brandId: brand.id }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    res.json({ brandCode: brand.code, channels: rows.map(toDto).filter((c): c is ChannelDto => c !== null), landingUrl: publicBaseUrl ? `${publicBaseUrl}/` : null, brandUrl: publicBaseUrl ? `${publicBaseUrl}/m/${brand.code}` : null });
  });

  router.put("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const channel = Number.isInteger(id) ? await db.brandChannel.findUnique({ where: { id } }) : null;
    if (!channel || !isChannelKind(channel.kind)) return res.status(404).json({ error: "Kanal bulunamadı." });
    const parsed = z
      .object({ label: z.string().trim().min(1, "Buton yazısı gerekli.").max(60, "Buton yazısı en fazla 60 karakter."), value: z.string().max(400), enabled: z.boolean() })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz istek." });
    const value = validateChannelValue(channel.kind, parsed.data.value);
    if (!value.ok) return res.status(400).json({ error: value.error });
    if (parsed.data.enabled && !value.value) return res.status(400).json({ error: "Kanalı açmak için önce değerini (numara ya da bağlantı) girin." });
    const updated = await db.brandChannel.update({ where: { id }, data: { label: parsed.data.label, value: value.value, enabled: parsed.data.enabled } });
    res.json(toDto(updated));
  });

  router.post("/:id/move", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = z.object({ direction: z.enum(["up", "down"]) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "direction (up/down) gerekli." });
    const channel = Number.isInteger(id) ? await db.brandChannel.findUnique({ where: { id } }) : null;
    if (!channel) return res.status(404).json({ error: "Kanal bulunamadı." });
    const rows = await db.brandChannel.findMany({ where: { brandId: channel.brandId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true } });
    const moves = moveInOrder(rows, id, parsed.data.direction);
    if (moves) await db.$transaction(moves.map((m) => db.brandChannel.update({ where: { id: m.id }, data: { sortOrder: m.position } })));
    res.json({ moved: moves !== null });
  });

  // Son N gün: sayfa görüntüleme ve buton tıklamaları
  router.get("/stats", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const groups = await db.hit.groupBy({ by: ["event", "kind"], where: { brandId: brand.id, createdAt: { gte: since } }, _count: { _all: true } });
    const landing = await db.hit.count({ where: { event: "landing", createdAt: { gte: since } } });
    const dto: ChannelStatsDto = { days, landing, brandVisits: 0, clicks: {} };
    for (const g of groups) {
      if (g.event === "brand") dto.brandVisits += g._count._all;
      if (g.event === "click" && g.kind) dto.clicks[g.kind] = g._count._all;
    }
    res.json(dto);
  });

  // QR kodu (PNG): target=landing (iki markalı ana sayfa) ya da brand (o markanın sayfası)
  router.get("/qr", async (req, res) => {
    if (!publicBaseUrl) return res.status(503).json({ error: "PUBLIC_BASE_URL tanımlı değil." });
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const target = req.query.target === "brand" ? "brand" : "landing";
    const url = target === "brand" ? `${publicBaseUrl}/m/${brand.code}` : `${publicBaseUrl}/`;
    const png = await QRCode.toBuffer(url, { type: "png", width: 900, margin: 2, errorCorrectionLevel: "M" });
    res.set("Content-Type", "image/png");
    if (req.query.download === "1") res.set("Content-Disposition", `attachment; filename="qr-${target === "brand" ? brand.code : "yerinde"}.png"`);
    res.send(png);
  });

  return router;
}

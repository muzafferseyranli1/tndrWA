import express, { Router } from "express";
import { z } from "zod";
import type { OptionChoice, OptionGroup, PrismaClient, ProductOptionGroup } from "@prisma/client";
import { formatTRY, parsePriceToKurus } from "../../shared/money";
import type { OptionGroupDto } from "../../shared/types";
import { resolveBrand } from "../services/brands";
import { MAX_CHOICES } from "../services/options";
import { moveInOrder } from "./products";

type GroupRow = OptionGroup & { choices: OptionChoice[]; products: ProductOptionGroup[] };

const toDto = (g: GroupRow): OptionGroupDto => ({
  id: g.id,
  name: g.name,
  required: g.required,
  enabled: g.enabled,
  productIds: g.products.map((p) => p.productId),
  choices: g.choices.map((c) => ({ id: c.id, name: c.name, extraKurus: c.extraKurus, priceText: c.extraKurus > 0 ? `+${formatTRY(c.extraKurus)}` : "Ücretsiz", enabled: c.enabled })),
});

const INCLUDE = { choices: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] }, products: true };

/** Ekstra ücret girişi: boş ya da 0 = ücretsiz; "25" ya da "25,50" TL. */
const extraPrice = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const text = String(v).trim();
    if (text === "" || Number(text.replace(",", ".")) === 0) return 0;
    const kurus = parsePriceToKurus(v);
    if (kurus === null || kurus < 0 || kurus > 1_000_000) {
      ctx.addIssue({ code: "custom", message: "Geçerli bir ücret girin (örn. 25 ya da 25,50; ücretsizse boş bırakın)." });
      return z.NEVER;
    }
    return kurus;
  });

const groupBody = z.object({
  name: z.string().trim().min(1, "Soru başlığı gerekli.").max(40, "Başlık en fazla 40 karakter."),
  required: z.boolean(),
});
const choiceBody = z.object({ name: z.string().trim().min(1, "Seçenek adı gerekli.").max(24, "Seçenek adı en fazla 24 karakter (WhatsApp liste sınırı)."), price: extraPrice });

/** Panel: seçenek grupları (acı seviyesi, sos, boy...), seçenekleri ve ekstra ücretleri, ürünlere bağlama. */
export function optionsRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(express.json({ limit: "20kb" }));

  const group = async (id: number) => db.optionGroup.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  const fail = (res: express.Response, status: number, error: string) => res.status(status).json({ error });
  const idOf = (req: express.Request) => Number(req.params.id);

  router.get("/", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return fail(res, 404, "Marka bulunamadı.");
    const rows = await db.optionGroup.findMany({ where: { brandId: brand.id }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], include: INCLUDE });
    res.json(rows.map(toDto));
  });

  router.post("/groups", async (req, res) => {
    const parsed = groupBody.extend({ brandId: z.number().int().optional() }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? "Geçersiz istek.");
    const brand = await resolveBrand(db, parsed.data.brandId === undefined ? undefined : String(parsed.data.brandId));
    if (!brand) return fail(res, 404, "Marka bulunamadı.");
    if (await db.optionGroup.findUnique({ where: { brandId_name: { brandId: brand.id, name: parsed.data.name } } })) return fail(res, 409, "Bu başlıkta bir grup zaten var.");
    const last = await db.optionGroup.findFirst({ where: { brandId: brand.id }, orderBy: { sortOrder: "desc" } });
    const created = await db.optionGroup.create({ data: { brandId: brand.id, name: parsed.data.name, required: parsed.data.required, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    res.status(201).json(toDto(await group(created.id)));
  });

  router.put("/groups/:id", async (req, res) => {
    const parsed = groupBody.extend({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? "Geçersiz istek.");
    const existing = Number.isInteger(idOf(req)) ? await db.optionGroup.findUnique({ where: { id: idOf(req) } }) : null;
    if (!existing) return fail(res, 404, "Grup bulunamadı.");
    const clash = await db.optionGroup.findFirst({ where: { brandId: existing.brandId, name: parsed.data.name, NOT: { id: existing.id } } });
    if (clash) return fail(res, 409, "Bu başlıkta bir grup zaten var.");
    await db.optionGroup.update({ where: { id: existing.id }, data: parsed.data });
    res.json(toDto(await group(existing.id)));
  });

  router.delete("/groups/:id", async (req, res) => {
    const existing = Number.isInteger(idOf(req)) ? await db.optionGroup.findUnique({ where: { id: idOf(req) } }) : null;
    if (!existing) return fail(res, 404, "Grup bulunamadı.");
    await db.optionGroup.delete({ where: { id: existing.id } }); // seçenekler ve ürün bağlantıları silinir; eski siparişlerdeki cevaplar kalır (ad olarak saklıdır)
    res.json({ deleted: true });
  });

  router.post("/groups/:id/move", async (req, res) => {
    const parsed = z.object({ direction: z.enum(["up", "down"]) }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "direction (up/down) gerekli.");
    const existing = Number.isInteger(idOf(req)) ? await db.optionGroup.findUnique({ where: { id: idOf(req) } }) : null;
    if (!existing) return fail(res, 404, "Grup bulunamadı.");
    const rows = await db.optionGroup.findMany({ where: { brandId: existing.brandId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true } });
    const moves = moveInOrder(rows, existing.id, parsed.data.direction);
    if (moves) await db.$transaction(moves.map((m) => db.optionGroup.update({ where: { id: m.id }, data: { sortOrder: m.position } })));
    res.json({ moved: moves !== null });
  });

  // Gruba bağlı ürünler (tam liste gönderilir). Porsiyonlu bir ürün seçilirse aynı yemeğin tüm porsiyonları da bağlanır.
  router.put("/groups/:id/products", async (req, res) => {
    const parsed = z.object({ productIds: z.array(z.number().int()).max(1000) }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "productIds (sayı listesi) gerekli.");
    const existing = Number.isInteger(idOf(req)) ? await db.optionGroup.findUnique({ where: { id: idOf(req) } }) : null;
    if (!existing) return fail(res, 404, "Grup bulunamadı.");
    const picked = await db.product.findMany({ where: { id: { in: parsed.data.productIds }, brandId: existing.brandId }, select: { id: true, groupKey: true } });
    const keys = picked.map((p) => p.groupKey).filter((k): k is string => !!k);
    const siblings = keys.length ? await db.product.findMany({ where: { brandId: existing.brandId, groupKey: { in: keys } }, select: { id: true } }) : [];
    const ids = [...new Set([...picked.map((p) => p.id), ...siblings.map((p) => p.id)])];
    await db.$transaction([db.productOptionGroup.deleteMany({ where: { groupId: existing.id } }), db.productOptionGroup.createMany({ data: ids.map((productId) => ({ productId, groupId: existing.id })) })]);
    res.json(toDto(await group(existing.id)));
  });

  router.post("/groups/:id/choices", async (req, res) => {
    const parsed = choiceBody.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? "Geçersiz istek.");
    const existing = Number.isInteger(idOf(req)) ? await db.optionGroup.findUnique({ where: { id: idOf(req) } }) : null;
    if (!existing) return fail(res, 404, "Grup bulunamadı.");
    if (await db.optionChoice.findFirst({ where: { groupId: existing.id, name: parsed.data.name } })) return fail(res, 409, "Bu grupta aynı adlı seçenek zaten var.");
    if ((await db.optionChoice.count({ where: { groupId: existing.id, enabled: true } })) >= MAX_CHOICES) return fail(res, 409, `Bir grupta en fazla ${MAX_CHOICES} açık seçenek olabilir (WhatsApp liste sınırı).`);
    const last = await db.optionChoice.findFirst({ where: { groupId: existing.id }, orderBy: { sortOrder: "desc" } });
    await db.optionChoice.create({ data: { groupId: existing.id, name: parsed.data.name, extraKurus: parsed.data.price, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    res.status(201).json(toDto(await group(existing.id)));
  });

  router.put("/choices/:id", async (req, res) => {
    const parsed = choiceBody.extend({ enabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message ?? "Geçersiz istek.");
    const existing = Number.isInteger(idOf(req)) ? await db.optionChoice.findUnique({ where: { id: idOf(req) } }) : null;
    if (!existing) return fail(res, 404, "Seçenek bulunamadı.");
    const clash = await db.optionChoice.findFirst({ where: { groupId: existing.groupId, name: parsed.data.name, NOT: { id: existing.id } } });
    if (clash) return fail(res, 409, "Bu grupta aynı adlı seçenek zaten var.");
    if (parsed.data.enabled && !existing.enabled && (await db.optionChoice.count({ where: { groupId: existing.groupId, enabled: true } })) >= MAX_CHOICES) {
      return fail(res, 409, `Bir grupta en fazla ${MAX_CHOICES} açık seçenek olabilir (WhatsApp liste sınırı).`);
    }
    await db.optionChoice.update({ where: { id: existing.id }, data: { name: parsed.data.name, extraKurus: parsed.data.price, enabled: parsed.data.enabled } });
    res.json(toDto(await group(existing.groupId)));
  });

  router.delete("/choices/:id", async (req, res) => {
    const existing = Number.isInteger(idOf(req)) ? await db.optionChoice.findUnique({ where: { id: idOf(req) } }) : null;
    if (!existing) return fail(res, 404, "Seçenek bulunamadı.");
    await db.optionChoice.delete({ where: { id: existing.id } });
    res.json(toDto(await group(existing.groupId)));
  });

  router.post("/choices/:id/move", async (req, res) => {
    const parsed = z.object({ direction: z.enum(["up", "down"]) }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "direction (up/down) gerekli.");
    const existing = Number.isInteger(idOf(req)) ? await db.optionChoice.findUnique({ where: { id: idOf(req) } }) : null;
    if (!existing) return fail(res, 404, "Seçenek bulunamadı.");
    const rows = await db.optionChoice.findMany({ where: { groupId: existing.groupId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true } });
    const moves = moveInOrder(rows, existing.id, parsed.data.direction);
    if (moves) await db.$transaction(moves.map((m) => db.optionChoice.update({ where: { id: m.id }, data: { sortOrder: m.position } })));
    res.json(toDto(await group(existing.groupId)));
  });

  return router;
}

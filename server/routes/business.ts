import express, { Router } from "express";
import { z } from "zod";
import type { DeletionRequest, PrismaClient } from "@prisma/client";
import type { BusinessSettingsDto, DeletionRequestDto } from "../../shared/types";
import { RETENTION_LIMITS, businessReady, eraseByPhone, getBusiness, getRetention, setBusiness, setRetention } from "../services/business";

const toDto = (r: DeletionRequest, matching: number): DeletionRequestDto => ({
  id: r.id,
  createdAt: r.createdAt.toISOString(),
  phone: r.phone,
  note: r.note,
  status: r.status === "DONE" || r.status === "REJECTED" ? r.status : "PENDING",
  handledAt: r.handledAt?.toISOString() ?? null,
  handledNote: r.handledNote,
  matchingCustomers: matching,
});

const days = (key: keyof typeof RETENTION_LIMITS) => {
  const [min, max] = RETENTION_LIMITS[key];
  return z.number().int().min(min, `En az ${min} gün olabilir.`).max(max, `En fazla ${max} gün olabilir.`);
};

/** Panel: işletme/KVKK bilgileri, saklama süreleri ve veri silme talepleri. */
export function businessRouter(db: PrismaClient, publicBaseUrl: string | null): Router {
  const router = Router();
  router.use(express.json({ limit: "5kb" }));

  const settings = async (): Promise<BusinessSettingsDto> => {
    const info = await getBusiness(db);
    return {
      info,
      retention: await getRetention(db),
      ready: businessReady(info),
      policyUrl: publicBaseUrl ? `${publicBaseUrl}/gizlilik` : null,
      deletionUrl: publicBaseUrl ? `${publicBaseUrl}/veri-silme` : null,
    };
  };

  router.get("/", async (_req, res) => res.json(await settings()));

  router.put("/", async (req, res) => {
    const parsed = z
      .object({
        info: z
          .object({
            legalName: z.string().trim().max(200),
            address: z.string().trim().max(400),
            email: z.string().trim().max(120).refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Geçerli bir e-posta adresi girin."),
            phone: z.string().trim().max(40),
            verbis: z.string().trim().max(60),
          })
          .partial()
          .optional(),
        retention: z.object({ messagesDays: days("messagesDays"), ordersDays: days("ordersDays"), ratingsDays: days("ratingsDays") }).partial().optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz istek." });
    if (parsed.data.info) await setBusiness(db, parsed.data.info);
    if (parsed.data.retention) await setRetention(db, parsed.data.retention);
    res.json(await settings());
  });

  router.get("/deletion-requests", async (req, res) => {
    const status = req.query.status === "all" ? undefined : "PENDING";
    const rows = await db.deletionRequest.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 100 });
    const out: DeletionRequestDto[] = [];
    for (const r of rows) out.push(toDto(r, await db.customer.count({ where: { waId: r.phone } })));
    res.json(out);
  });

  router.post("/deletion-requests/:id/process", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = z.object({ action: z.enum(["erase", "reject"]), note: z.string().trim().max(300).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "action (erase/reject) gerekli." });
    const existing = Number.isInteger(id) ? await db.deletionRequest.findUnique({ where: { id } }) : null;
    if (!existing) return res.status(404).json({ error: "Talep bulunamadı." });
    if (existing.status !== "PENDING") return res.status(409).json({ error: "Bu talep zaten işlendi." });

    let note = parsed.data.note ?? "";
    let status = "REJECTED";
    if (parsed.data.action === "erase") {
      const r = await eraseByPhone(db, existing.phone);
      status = "DONE";
      note = `${note ? `${note} · ` : ""}Silindi: ${r.customers} müşteri, ${r.messages} mesaj, ${r.addresses} adres, ${r.ratings} değerlendirme, ${r.events} ham olay`;
    }
    const updated = await db.deletionRequest.update({ where: { id }, data: { status, handledAt: new Date(), handledNote: note } });
    res.json(toDto(updated, await db.customer.count({ where: { waId: updated.phone } })));
  });

  return router;
}

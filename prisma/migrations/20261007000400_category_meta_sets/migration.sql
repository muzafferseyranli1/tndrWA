ALTER TABLE "Category" ADD COLUMN "metaSetId" TEXT;
ALTER TABLE "Category" ADD COLUMN "metaSetSig" TEXT;

-- Ürün verisinden "link" alanı kaldırıldı: tüm ürünler Meta'ya yeniden gönderilsin
UPDATE "Product" SET "metaSyncState" = 'PENDING' WHERE "onMeta" = 1;

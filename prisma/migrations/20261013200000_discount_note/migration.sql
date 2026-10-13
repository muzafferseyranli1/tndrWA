-- Kampanya açıklaması (sipariş indirim satırında gösterilir)
ALTER TABLE "Order" ADD COLUMN "discountNote" TEXT NOT NULL DEFAULT '';

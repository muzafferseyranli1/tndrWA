-- Yerinde Pide menüsü ilk yüklemede "aktif" geldi, ancak ürün görselleri henüz yok (Meta görselsiz ürünü reddeder).
-- Görseli yüklenip aktifleştirilene kadar pasif tutulur. Yalnızca dokunulmamış kayıtlar etkilenir:
-- görseli olan veya Meta'ya gönderilmiş ürünler (kullanıcının üzerinde çalıştıkları) olduğu gibi kalır.
UPDATE "Product" SET "status" = 'PASSIVE' WHERE "brandId" = 2 AND "status" = 'ACTIVE' AND "imagePath" IS NULL AND "onMeta" = 0;

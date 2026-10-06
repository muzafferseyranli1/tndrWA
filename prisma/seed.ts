// Menü başlangıç verisi. Tekrar çalıştırılabilir: mevcut ürünlere dokunmaz.
// Yerinde Tandır: Yemeksepeti partner ekran görüntülerinden. Yerinde Pide: prisma/data/pide-menu.json (satış fiyat listesi).
// Kategori sırası Yemeksepeti menüsündeki gibidir.
// Fiyatlar LİSTE fiyatıdır; nakit/kart %15 indirimi sipariş anında uygulanır.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { slugify } from "../shared/slug";

const db = new PrismaClient();

interface Seed {
  name: string;
  description: string;
  price: number; // TL
  status?: "ACTIVE" | "PASSIVE";
}

const TANDIR_MENU: { category: string; items: Seed[] }[] = [
  {
    category: "Menüler",
    items: [
      // Paket (seçimli) ürünler: ürünün içindeki seçimler katalogda tutulamaz, sipariş sonrası müşteriye sorulur (bkz. PLAN.md)
      { name: "Pide Sandviç Menü", description: "Seçeceğiniz Pide Sandviç + Patates Kızartması + Seçeceğiniz İçecek", price: 600, status: "PASSIVE" },
      { name: "Bol Pide Sandviç Menü", description: "Seçeceğiniz Pide Sandviç + Et Tandır (60 g) + Patates Kızartması + Seçeceğiniz İçecek", price: 975, status: "PASSIVE" },
      // Ekranda kesikti ("... 2 Adet"); seçim gruplarından (2 sos + 2 içecek) tamamlandı
      { name: "İki Kişilik Tandır Menü", description: "Kuzu Tandır (400 g) (Bulgur pilavı, közlenmiş biber, sumaklı soğan, lavaş ile) + 2 Adet Seçeceğiniz Sos + 2 Adet Seçeceğiniz İçecek", price: 2450, status: "PASSIVE" },
      { name: "Dört Kişilik Tandır Menü", description: "Kuzu Tandır (800 g) (Bulgur pilavı, közlenmiş biber, sumaklı soğan, lavaş ile) + 4 Adet Seçeceğiniz Sos + 4 Adet Seçeceğiniz İçecek", price: 4800, status: "PASSIVE" },
    ],
  },
  {
    category: "Çorbalar",
    items: [{ name: "Tandır Suyu Çorbası", description: "Kuzu tandır suyu, didiklenmiş et, nohut, arpa şehriye", price: 375, status: "PASSIVE" }],
  },
  {
    category: "Tandır Sandviçler",
    items: [
      { name: "Mantarlı Karamelize Soğanlı Tandır Pide Sandviç", description: "100 g kuzu tandır eti, mantar, soğan", price: 949 },
      { name: "Tandır & Cheese Pide Sandviç", description: "100 g kuzu eti, kaşar peyniri, mozzarella peyniri, karamelize soğan sosu, turşu", price: 949 },
      // Açıklama ekranda kesikti, görünen kısım alındı; fiyat ilk bedenin fiyatı (bedenler henüz bilinmiyor)
      { name: "Kuzu Tandırlı Karadeniz Pidesi (kapalı)", description: "Karadeniz usulü kapalı pide içerisinde tandırda pişirilmiş yumuşak kuzu eti baharat ve soğan ile harmanlı", price: 1050 },
    ],
  },
  {
    category: "Dürümler",
    items: [
      { name: "Mantarlı Karamelize Soğanlı Tandır Dürüm", description: "120 g kuzu eti, 40 g mantarlı karamelize soğan, maydanoz", price: 1099 },
      { name: "Sebzeli Sossuz Tandır Dürüm", description: "120 g kuzu eti, domates, közlenmiş yeşil biber, közlenmiş kırmızıbiber, kırmızı soğan, maydanoz", price: 1099 },
    ],
  },
  {
    category: "Et Tandırlar",
    items: [
      { name: "Tandır Tabağı (100 g)", description: "100 g kuzu tandır, 180 g bulgur pilavı, közlenmiş yeşil biber, sumaklı soğan, maydanoz, lavaş", price: 999 },
      { name: "Tandır Tabağı (150 g)", description: "150 g kuzu tandır, 180 g bulgur pilavı. Közlenmiş biber, sumaklı soğan, maydanoz, lavaş", price: 1350 },
      { name: "Tandır Tabağı (200 g)", description: "200 g kuzu tandır, 180 g bulgur pilavı. Közlenmiş biber, sumaklı soğan, maydanoz, lavaş", price: 1599 },
    ],
  },
  {
    category: "Bowls",
    items: [{ name: "Anadolu Tandır Bowl", description: "100 g kuzu tandır, bulgur pilavı, nohut, közlenmiş mevsim sebzeleri, kırmızılahana, salatalık, maydanoz", price: 650, status: "PASSIVE" }],
  },
  {
    category: "Pilavlar",
    items: [{ name: "Başbaşı Bulgur Pilavı (180 g)", description: "180 g başbaşı bulguru, kuzu eti suyu, tereyağı", price: 150 }],
  },
  {
    category: "Mezeler",
    items: [
      { name: "Közlenmiş Patlıcan Ezmesi (120 g)", description: "120 g olarak servis edilir.", price: 75, status: "PASSIVE" },
      { name: "Sumaklı Soğan (120 g)", description: "120 g olarak servis edilir.", price: 125, status: "PASSIVE" },
      { name: "Yoğurtlu Kırmızılahana (150 g)", description: "150 g olarak servis edilir.", price: 125, status: "PASSIVE" },
      { name: "Lavaş Cipsi & Dip Sos", description: "Fırınlanmış lavaş, dip sos", price: 100, status: "PASSIVE" },
      { name: "Karamelize Soğan (30 g)", description: "30 g olarak servis edilir.", price: 75, status: "PASSIVE" },
    ],
  },
  {
    category: "Yan Ürünler",
    items: [{ name: "Jalapeno Biber Turşusu (25 g)", description: "25 g olarak servis edilir.", price: 75, status: "PASSIVE" }],
  },
  {
    category: "Tatlılar",
    items: [{ name: "Fırın Sütlaç", description: "Adet olarak servis edilir. İsteğe bağlı tarçın ile", price: 275 }],
  },
  {
    category: "İçecekler",
    items: [
      { name: "Coca-Cola (33 cl)", description: "Kutu içecek", price: 140 },
      { name: "Coca-Cola Zero Sugar (33 cl)", description: "Kutu içecek", price: 140 },
      { name: "Şalgam Suyu (30 cl)", description: "Pet şişe", price: 175 },
      { name: "Ayran (30 cl)", description: "Büyük boy", price: 110 },
      { name: "Soda (20 cl)", description: "Cam şişe", price: 60 },
      { name: "Su (50 cl)", description: "Pet şişe", price: 60 },
      { name: "Ev Yapımı Limonata", description: "Soğuk servis edilir.", price: 175 },
    ],
  },
];

interface Row {
  name: string;
  description: string;
  priceKurus: number;
  status: "ACTIVE" | "PASSIVE";
  groupKey: string | null;
  variantLabel: string | null;
}

/** Yerinde Pide satış listesi (görseller yüklenip aktifleştirilene kadar PASİF gelir): porsiyonlu ürünler (örn. 1 Porsiyon / 1,5 Porsiyon) ayrı kayıt, aynı groupKey. */
interface PideItem {
  kod: string;
  name: string;
  priceKurus?: number;
  variants?: { label: string; priceKurus: number }[];
}

function loadPide(): { category: string; rows: Row[] }[] {
  const data = JSON.parse(readFileSync(path.join(__dirname, "data", "pide-menu.json"), "utf-8")) as { category: string; items: PideItem[] }[];
  return data.map((g) => ({
    category: g.category,
    rows: g.items.flatMap((it): Row[] =>
      it.variants
        ? it.variants.map((v) => ({ name: it.name, description: "", priceKurus: v.priceKurus, status: "PASSIVE" as const, groupKey: it.kod, variantLabel: v.label }))
        : [{ name: it.name, description: "", priceKurus: it.priceKurus!, status: "PASSIVE" as const, groupKey: null, variantLabel: null }],
    ),
  }));
}

function loadTandir(): { category: string; rows: Row[] }[] {
  return TANDIR_MENU.map((g) => ({
    category: g.category,
    rows: g.items.map((i) => ({ name: i.name, description: i.description, priceKurus: Math.round(i.price * 100), status: i.status ?? "ACTIVE", groupKey: null, variantLabel: null })),
  }));
}

async function seedBrand(code: string, menu: { category: string; rows: Row[] }[], ifEmpty: boolean): Promise<string> {
  const brand = await db.brand.findUnique({ where: { code } });
  if (!brand) return `${code}: marka bulunamadı (migration uygulanmamış?)`;
  // --if-empty: o markanın hiç ürünü yoksa yükle (sunucuda ilk açılış). Sonradan silinen/değişen ürünler geri gelmez.
  if (ifEmpty && (await db.product.count({ where: { brandId: brand.id } })) > 0) return `${brand.name}: atlandı (zaten ürün var)`;

  let created = 0;
  let existed = 0;
  const used = new Set<string>(); // retailer_id marka genelinde benzersiz; aynı slug çıkarsa -2, -3 eklenir (her çalıştırmada aynı sırayla)
  for (const [catIndex, group] of menu.entries()) {
    const category = await db.category.upsert({
      where: { brandId_name: { brandId: brand.id, name: group.category } },
      update: { sortOrder: catIndex },
      create: { brandId: brand.id, name: group.category, sortOrder: catIndex },
    });
    for (const [i, row] of group.rows.entries()) {
      const base = slugify(row.variantLabel ? `${row.name} ${row.variantLabel}` : row.name) || "urun";
      let retailerId = base;
      for (let n = 2; used.has(retailerId); n++) retailerId = `${base}-${n}`;
      used.add(retailerId);
      const existing = await db.product.findUnique({ where: { brandId_retailerId: { brandId: brand.id, retailerId } } });
      if (existing) {
        existed++;
        continue;
      }
      await db.product.create({
        data: {
          brandId: brand.id,
          retailerId,
          name: row.name,
          description: row.description,
          priceKurus: row.priceKurus,
          categoryId: category.id,
          status: row.status,
          groupKey: row.groupKey,
          variantLabel: row.variantLabel,
          sortOrder: i,
        },
      });
      created++;
    }
  }
  return `${brand.name}: ${created} ürün eklendi, ${existed} ürün zaten vardı (dokunulmadı)`;
}

async function main() {
  const ifEmpty = process.argv.includes("--if-empty");
  console.log(await seedBrand("tandir", loadTandir(), ifEmpty));
  console.log(await seedBrand("pide", loadPide(), ifEmpty));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

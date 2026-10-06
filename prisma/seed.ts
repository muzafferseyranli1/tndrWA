// Menü başlangıç verisi (Yemeksepeti partner ekran görüntülerinden). Tekrar çalıştırılabilir (retailerId'ye göre upsert).
// Kategori sırası Yemeksepeti menüsündeki gibidir.
// Fiyatlar LİSTE fiyatıdır; nakit/kart %15 indirimi sipariş anında uygulanır.
import { PrismaClient } from "@prisma/client";
import { slugify } from "../shared/slug";

const db = new PrismaClient();

interface Seed {
  name: string;
  description: string;
  price: number; // TL
  status?: "ACTIVE" | "PASSIVE";
}

const MENU: { category: string; items: Seed[] }[] = [
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

async function main() {
  let created = 0;
  let updated = 0;
  for (const [catIndex, group] of MENU.entries()) {
    const category = await db.category.upsert({
      where: { name: group.category },
      update: { sortOrder: catIndex },
      create: { name: group.category, sortOrder: catIndex },
    });
    for (const [i, item] of group.items.entries()) {
      const retailerId = slugify(item.name);
      const data = {
        name: item.name,
        description: item.description,
        priceKurus: Math.round(item.price * 100),
        categoryId: category.id,
        status: item.status ?? "ACTIVE",
        sortOrder: i,
      };
      const existing = await db.product.findUnique({ where: { retailerId } });
      if (existing) {
        // Panelden yapılan değişiklikleri ezme: yalnızca henüz değiştirilmemiş alanları dokunmadan bırak
        updated++;
        continue;
      }
      await db.product.create({ data: { retailerId, ...data } });
      created++;
    }
  }
  console.log(`Seed tamam: ${created} ürün eklendi, ${updated} ürün zaten vardı (dokunulmadı).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());

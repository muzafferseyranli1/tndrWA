# tndrWA Yol Haritası

Hedef: Müşteri QR/link ile WhatsApp kataloğuna girer, sipariş verir. Panel siparişi yakalar, sesle haber verir, sipariş düzenlenir, müşteriyle yazışılır, durum değişikliklerinde müşteriye WhatsApp mesajı gider.

**Kararlar (kullanıcıyla netleşen):** Türkçe arayüz, tek kullanıcı, yalnızca web (duyarlı), MyWA'dan tamamen bağımsız (ayrı repo, ayrı Coolify uygulaması, ayrı WAHA), alan adı `tndrwa.derinsoft.com.tr`, ücretsiz kalma hedefi, siparişler yalnızca WhatsApp'tan, eski numara kullanılacak, kanal WAHA (adaptörlü, sonra Cloud API'ye geçilebilir), veritabanı SQLite.

## Mevcut durum (6 Ekim 2026)
- Meta: yeni portföy, katalog (`1868568421015157`), uygulama, sistem kullanıcısı, jeton hazır. Okuma ve tek ürün oluştur/güncelle/sil testi **başarılı** (`scripts/meta-check.mjs`, `scripts/meta-write-test.mjs`).
- Henüz yok: uygulama iskeleti, panel, WAHA, deploy.

## Çok marka (bulut mutfak) — 7 Ekim 2026'da eklendi
İki marka tek panelde: **Yerinde Tandır** ve **Yerinde Pide**. Marka başına ayrı: ürünler/kategoriler, Meta kataloğu (+ isteğe bağlı ayrı jeton `META_ACCESS_TOKEN_<KOD>`), WhatsApp numarası ve WAHA oturumu (`Brand.waSession`), mesaj şablonları, ödeme tipi/indirim kuralları. Ortak: giriş, mutfak sipariş ekranı. `retailerId` ve kategori adı marka içinde benzersiz. İkinci markanın Meta bağlantısı hazır olmadan eklenebilir: katalog kimliği boş kalır, o marka için gönderim kapalıdır; hazır olunca Markalar sayfasından girilir.

**Porsiyonlar (varyant):** Her porsiyonun kendi fiyatı vardır ve katalogda ayrı ürün olarak görünür (`item_group_id` ile bağlı, başlık "Ad (Porsiyon)"). "1,5 Porsiyon" = fiyat x 1,5, en yakın tam liraya yuvarlanır (632,50 -> 949). "Yarım" porsiyonlar kullanılmaz. Diğer porsiyonlar (500 gr, 4 Kişi, Az...) açık fiyatla eklenir. Görsel aynı yemeğin tüm porsiyonlarında ortaktır. Bu, Aşama 5f'deki "sipariş sonrası porsiyon sorusu" fikrinin yerini alır; seçenek grupları (sos/içecek seçimi, ek ücret) 5f'de ayrıca yapılacak.

## Mimari
```
Müşteri → WhatsApp kataloğu → sepet/sipariş mesajı
   → WAHA (webhook) → tndrWA sunucusu → SQLite
   → SSE ile panel (ses + canlı liste) ← → yazışma, durum, düzenleme
   → WAHA ile müşteriye mesaj;  Meta Graph API ← ürün yönetimi
```
- Next.js 15 + Express 4 + TypeScript + Tailwind, Prisma + SQLite (dosya kalıcı volume'de).
- Mesaj kanalı `WhatsAppChannel` arayüzü arkasında: `WahaChannel` şimdi, `CloudApiChannel` ileride.
- Canlı güncelleme: SSE (WebSocket değil, daha basit).
- Zamanlı mesajlar DB'de (`ScheduledMessage`), sunucu yeniden başlasa kaybolmaz.

## Veri modeli (taslak)
`Product`, `Order`, `OrderItem` (ad/fiyat anlık kopya), `Customer`, `Message` (yazışma), `ScheduledMessage`, `Setting` (durum mesajı şablonları), `User`.

## Aşamalar
**Aşama 1: İskelet**
`.gitignore`/`.env.example` (hazır), Express+Next+Prisma, giriş (bcrypt, httpOnly cookie, kaba kuvvet sınırı), `npm run typecheck`/`npm test`, Dockerfile, eksik değişkende açık hata ile başlamama.

**Aşama 2: Katalog paneli**
Meta Graph servisi (tek dosya, sürüm env'den, enjekte edilebilir istemci + mock'lu testler); ürün listesi/ekle/düzenle/sil; fiyat ve indirimli fiyat; görsel yükleme (magic-byte doğrulama, boyut sınırı, herkese açık HTTPS URL); Meta durum/ret nedenini Türkçe gösterme; menü seed'i; (isteğe bağlı) CSV içe aktarma önizlemeli.

**Aşama 3: İlk deploy (katalog paneli canlı)**
Önce VPS'te `df -h`, `free -h`, `docker system df`. Coolify'da yeni uygulama (Dockerfile), kalıcı volume (`/data`: SQLite + uploads), FQDN, ortam değişkenleri, migration hatası görünür. Push öncesi `NODE_ENV=production npx next build`.

**Aşama 4: WAHA kurulumu ve sipariş formatı keşfi**
Ayrı Coolify uygulaması (`devlikeapro/waha`), API anahtarı ve webhook gizli anahtarı, QR ile oturum. Test ürünüyle **gerçek bir test siparişi** verip WAHA'nın gönderdiği ham veriyi kaydetme; ayrıştırıcıyı bu veriye göre yazma. Katalogun WhatsApp numarasına bağlanması ve sepetin açılması (WhatsApp Manager). QR/link: `wa.me/c/<numara>`.

**Aşama 5: Siparişler**
Webhook → sipariş kaydı (kopya mesajları yinelenmeden), SSE ile panelde canlı liste, ses (panelde bir kez "sesi etkinleştir"), durum akışı: *alındı/sırada → hazırlanıyor → yola çıktı → teslim edildi*, sipariş düzenleme (ürün ekle/çıkar, adet, not), her durumda müşteriye düzenlenebilir şablon mesajı, teslimden 30 dk sonra değerlendirme linki (içerik sonra).

**Aşama 5b: Karşılama ve mesaj şablonları**
Ayarlar > Mesajlar ekranı: ilk karşılama, tekrar gelen müşteri, mesai dışı ve durum mesajları düzenlenebilir; değişkenler `{isim}`, `{siparis_no}`, `{toplam}`. Müşteri telefonla tanınır; ad önce panelde kayıtlı isimden, yoksa WhatsApp profil adından gelir (panelde düzeltilebilir), ad yoksa "Merhaba". Karşılama yalnızca ayarlı sessizlikten (varsayılan 12 saat) sonraki ilk müşteri mesajında gider, kısa doğal gecikmeyle. KVKK: müşteri kaydını silme özelliği ve aydınlatma metni.

**Aşama 5c: Siparişi tekrarla**
Tekrar gelen müşteriye karşılamada son sipariş özeti gider ("aynısı için 1 yazın"). Cevap gelince yeni sipariş oluşur: ürünler güncel katalog fiyatıyla, fiyat farkı/stok yok uyarısı panelde ve müşteri mesajında; varsayılan durum "onay bekliyor" (ayarla otomatik yapılabilir); adres/not önceki siparişten kopyalanır. WAHA'da tıklanabilir düğme yok, metin cevabı kullanılır.

**Aşama 5d: Ödeme tipleri**
Ayarlar > Ödeme tipleri: Nakit, Kapıda kredi kartı, Pluxee, Multinet, Setcard, Edenred, Havale/EFT; ad/aktiflik düzenlenir, yeni eklenir. Siparişte ödeme tipi alanı; panelden seçilir ya da sipariş sonrası otomatik mesajla müşteriden numara cevabıyla alınır. Havale/EFT için ayarlardaki IBAN/açıklama müşteriye gider. Panel ödeme almaz, yalnızca kaydeder; kart bilgisi tutulmaz.

**Aşama 5e: İndirim kuralları (kodda)**
Panelde kural yönetimi YOK (kullanıcı kararı: karmaşık kampanyalar için panel fazla karmaşıklaşır). `server/services/pricing` altında kural listesi: her kural küçük, testli, saf bir fonksiyon (ad, geçerlilik koşulu, indirim tutarı). Yeni kampanya kullanıcının talebiyle yeni kural olarak eklenir (deploy gerekir). Saat/gün koşulları Europe/Istanbul'a göre. İlk kural: ödeme tipi Nakit veya Kapıda kredi kartı ise %15 (yemek kartları ve Havale/EFT'de yok). Sipariş toplamında ayrı indirim satırı, müşteri mesajına yansır; ödeme tipi değişince yeniden hesaplanır; yuvarlama kuruşa. Varsayımlar: indirim katalogdaki güncel (indirimli) fiyatın üstüne uygulanır; birden fazla kural geçerliyse şimdilik en yüksek olan uygulanır, üst üste binmez (ikinci kural eklenirken netleştirilir).

**Aşama 5f: Seçenek grupları (genel özellik; paket menüler, Şalgam, Sütlaç, Karadeniz Pidesi ve tüm yeni ürünler)**
Tasarım: yeniden kullanılabilir `OptionGroup` (ad + seçenek listesi; seçenek serbest metin ya da mevcut ürün) ve ürüne bağlama tablosu (`ProductOptionGroup`: zorunlu mu, kaç kez sorulacak). Ürün düzenleme sayfasında "Seçenek grupları" bölümü; grup değişince bağlı tüm ürünlerde güncellenir. Seçeneğe isteğe bağlı ek ücret (kuruş, varsayılan 0). Ürün bazında "porsiyon seçimi" (örn. 1 / 1,5 / 2): ürünün kendisi 1 porsiyon, seçilen çarpan ürün fiyatıyla çarpılır (150 TL x 1,5 = 225 TL). Satır tutarı = (liste fiyatı x porsiyon + seçenek ek ücretleri) x adet; porsiyon çarpanı yalnızca ürün fiyatına uygulanır, ek ücretlere değil; %15 indirim satır toplamları üzerinden; kuruşa yuvarlama (saf fonksiyon + testler). Porsiyon/seçim sipariş sonrası sorulduğu için toplam sepetten farklı olabilir; yeni toplam müşteriye bildirilir. Seçimler katalogda görünmez, sipariş sonrası WhatsApp'ta numaralı soruyla alınır.
Meta kataloğunda "içindeki seçimler" yok; paket ürün katalogda tek ürün olarak durur (şu an hepsi PASİF). Siparişte paket ürün varsa panel "seçim bekliyor" uyarır ve müşteriye otomatik soru gider ("Pide Sandviç Menü için sandviçiniz: 1 Mantarlı…, 2 Tandır & Cheese"; ardından içecek). Cevaplar sipariş kalemine işlenir; personel panelden elle de girebilir. Seçenek grupları (Yemeksepeti'nden):
- Pide Sandviç Menü (600 TL) ve Bol Pide Sandviç Menü (975 TL): "Pide Sandviç Seçimi" = Mantarlı Karamelize Soğanlı Tandır Pide Sandviç / Tandır & Cheese Pide Sandviç; "İçecek Seçimi" = Coca-Cola 33 cl / Coca-Cola Zero Sugar 33 cl / Şalgam Suyu 30 cl / Ayran 30 cl / Soda 20 cl.
- İki Kişilik Tandır Menü (2.450 TL): 1.-2. Sos Seçimi (Tandır Et Sosu / Mantar & Karamelize Soğan Sosu), 1.-2. İçecek Seçimi (yukarıdaki 5 içecek).
- Dört Kişilik Tandır Menü (4.800 TL): 1.-4. Sos Seçimi, 1.-4. İçecek Seçimi.
- Diğer seçenekler: Şalgam Suyu (acılı/acısız olabilir, ekran görüntüsü yok), Fırın Sütlaç (tarçın), Kuzu Tandırlı Karadeniz Pidesi (bedenler, ekran görüntüsü yok). Bunlar için sipariş notu/yazışma kullanılır; gerekirse aynı soru mekanizması eklenir.

**Aşama 6: Yazışma**
Müşteri bazlı konuşma ekranı, gelen/giden mesajlar, okunmamış göstergesi, siparişle ilişkilendirme.

**Aşama 7: Sağlamlaştırma**
SQLite yedeği, günlükler, hız sınırı, WAHA'ya gönderimde doğal gecikme (kısıtlama riskini azaltma), 24 saat penceresi dışı uyarısı, güvenlik gözden geçirme.

## Riskler
- WAHA resmi olmayan: numara kısıtlanabilir. Önlem: yalnızca müşteri yazdıktan sonra cevap, kanal adaptörü, Cloud API'ye geçiş yolu.
- Sepet siparişinin WAHA'dan nasıl geldiği henüz bilinmiyor (Aşama 4'te test edilecek).
- Numara, eski portföydeki WhatsApp hesabına kayıtlı olabilir. Kataloğu numaraya bağlamak için taşıma gerekebilir (Aşama 4'te kontrol).
- Meta jetonunun süresiz olduğu doğrulanmalı.
- Tarayıcı sesi, kullanıcı tıklaması olmadan çalmaz.
- Paylaşılan VPS'te disk/bellek: SQLite bu yüzden seçildi.

## Kullanıcıdan gerekenler
Aşama 1: kullanıcı adı `admin` (şifreyi `.env`'e siz yazarsınız). Aşama 2: menünün tam metinleri (kesik adlar/açıklamalar), ürün görselleri. Aşama 3: VPS disk çıktısı, Coolify erişimi. Aşama 4: WhatsApp numarası ve QR taraması.

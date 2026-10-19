"use client";

import { useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useBrands } from "@/lib/brand";

/** Personel ve yönetici için kısa kullanım kılavuzu. Kasa/mutfak personeli (USER) de açabilir; yönetici bölümü yalnız ADMIN'e görünür. */

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-5 scroll-mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

const B = ({ children }: { children: React.ReactNode }) => <b className="text-slate-900">{children}</b>;

export default function HelpPage() {
  const { brand } = useBrands();
  const [role, setRole] = useState<string | null>(null);
  const [hours, setHours] = useState<{ summary: string; minBasketKurus: number } | null>(null);

  useEffect(() => {
    api<{ role: string }>("/api/auth/me")
      .then((d) => setRole(d.role))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!brand) return;
    api<{ summary: string; minBasketKurus: number }>(`/api/hours?brandId=${brand.id}`)
      .then(setHours)
      .catch(() => setHours(null));
  }, [brand]);

  const admin = role === "ADMIN";
  const toc: [string, string][] = [
    ["akis", "Sipariş nasıl gelir"],
    ["yeni", "Yeni sipariş ve durumlar"],
    ["duzenle", "Düzenleme, adres, iptal"],
    ["yazisma", "Müşteriyle yazışma"],
    ["indirim", "İndirim ve kampanya"],
    ["saatler", "Çalışma saatleri"],
    ["tablet", "Tablet, ses ve ekran"],
    ...(admin ? ([["yonetici", "Yönetici işleri"]] as [string, string][]) : []),
  ];

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-1 text-2xl font-semibold">Kullanım kılavuzu</h1>
        <p className="mb-4 text-sm text-slate-500">Panelde günlük işler için kısa rehber. Bir şey ters giderse kartta yazan uyarıyı okuyun; çoğu zaman ne yapılacağı orada yazar.</p>

        <nav className="mb-5 flex flex-wrap gap-2 text-sm" aria-label="Kılavuz bölümleri">
          {toc.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:bg-slate-50">
              {label}
            </a>
          ))}
        </nav>

        <Section id="akis" title="1. Sipariş nasıl gelir">
          <p>
            Müşteri WhatsApp kataloğundan sepetini gönderir. Sistem müşteriye eksik bilgileri sırayla kendisi sorar: ilk siparişinde <B>KVKK bilgilendirmesi</B> (&quot;Okudum, devam&quot;), seçenekli üründe <B>seçenek</B>, sonra <B>ödeme şekli</B> ve <B>adres</B>.
          </p>
          <p>
            Bu sırada kart <B>gri</B> görünür ve &quot;Ödeme şekli bekleniyor&quot; gibi ne beklendiği yazar. Bir şey yapmanıza gerek yok; müşteri takılırsa &quot;Yazış&quot; ile yardımcı olabilirsiniz.
          </p>
          <p>
            Müşteri <B>5 dakika</B> yanıt vermezse soru hatırlatmayla tekrar gönderilir; <B>5 dakika</B> daha yanıt gelmezse sipariş otomatik iptal edilir ve müşteriye bildirilir. Kartta hatırlatma ve iptal saatleri yazar.
          </p>
          <p>
            Müşteri bize <B>1</B> yazarsa son siparişi güncel fiyatlarla yeniden oluşturulur (tükenen ürünler çıkarılır) ve aynı adımlar başlar.
          </p>
        </Section>

        <Section id="yeni" title="2. Yeni sipariş ve durumlar">
          <p>
            Müşteri adımları bitince kart <B>kırmızı çerçeveli &quot;Yeni&quot;</B> olur ve uyarı sesi çalar. Ses, siparişi işleme alana kadar birkaç saniyede bir tekrarlar.
          </p>
          <p>Karttaki yeşil düğmeyle sırayla ilerleyin:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <B>Hazırlanıyor</B>: siparişi işleme aldınız (ses durur).
            </li>
            <li>
              <B>Yola çıktı</B>: kurye çıktı. Adresi olmayan sipariş yola çıkarılamaz.
            </li>
            <li>
              <B>Teslim edildi</B>: sipariş &quot;Geçmiş&quot;e taşınır; müşteriye değerlendirme bağlantısı ve &quot;tekrar sipariş için 1 yazın&quot; bilgisi gider.
            </li>
          </ol>
          <p>
            Her basışta müşteriye WhatsApp mesajı <B>otomatik</B> gider. Gitmezse kartta kırmızı &quot;GİTMEDİ&quot; ve sebebi yazar; o zaman müşteriyi telefonla arayın.
          </p>
          <p>
            <B>Aktif</B> sekmesinde bekleyen ve yoldaki siparişler, <B>Geçmiş</B> sekmesinde teslim edilen ve iptal olanlar görünür. &quot;Sıralama&quot; düğmesi eskiden yeniye / yeniden eskiye çevirir. Adresin yanındaki &quot;Haritada aç&quot; konumu gösterir.
          </p>
        </Section>

        <Section id="duzenle" title="3. Düzenleme, adres, iptal">
          <p>
            <B>Düzenle</B> düğmesi, müşteri adımları bitmiş ve sipariş &quot;Yeni&quot; ya da &quot;Hazırlanıyor&quot;dayken görünür. Adet değiştirebilir, ürün ekleyip çıkarabilir, ödeme şeklini, adresi ve sipariş notunu değiştirebilirsiniz. Ödeme şekli değişince indirim yeniden hesaplanır.
          </p>
          <p>
            Değişiklikten sonra kartta <B>&quot;Müşteriye güncel özeti gönder&quot;</B> çıkar; basınca müşteriye yeni tutar ve ürünler gider. Unutmayın, müşteri haberdar olmadan tutar değişmesin.
          </p>
          <p>
            Kartta <B>&quot;teslimat adresi yok&quot;</B> uyarısı varsa Düzenle&apos;den kayıtlı adreslerden seçin ya da yeni adres yazın. Müşteri henüz adres adımındaysa beklemek daha doğru; adresi müşteri kendisi seçsin.
          </p>
          <p>
            <B>İptal et</B> onay ister; onaylayınca müşteriye iptal mesajı gider. Geri alınamaz, gerekirse müşteri yeniden sipariş verir.
          </p>
        </Section>

        <Section id="yazisma" title="4. Müşteriyle yazışma">
          <p>
            Sipariş kartındaki <B>Yazış</B> düğmesi, sayfadan ayrılmadan o müşterinin yazışmasını açar. Tüm konuşmalar üst menüdeki <B>Yazışma</B> sayfasında da var.
          </p>
          <p>
            <B>24 saat kuralı</B> (WhatsApp kuralı): müşteri son 24 saatte size yazmadıysa serbest mesaj gönderemezsiniz; kutu kapalı görünür. Müşteri yazınca yeniden açılır. Sipariş veren müşteri yeni yazmış olduğu için sipariş süresince pencere açıktır.
          </p>
          <p>Mesajın yanındaki işaretler: ✓ gönderildi, ✓✓ iletildi, mavi ✓✓ okundu, ⚠ gitmedi (sebebi yazar).</p>
        </Section>

        <Section id="indirim" title="5. İndirim ve kampanya">
          <p>
            <B>Nakit</B> ve <B>kapıda kredi kartı</B> ödemelerinde liste fiyatından <B>%15</B> indirim otomatik uygulanır; yemek kartlarında (Edenred vb.) indirim yoktur. Kartta indirimli tutar büyük, liste tutarı küçük yazar.
          </p>
          <p>
            <B>Perşembe kampanyası</B> (yalnız Yerinde Tandır, 18:00&apos;e kadar gelen, 1.000 TL ve üstü siparişler, nakit/kapıda kart): <B>Et Tandırlar %50</B>, diğer ürünler %15. Kampanyalı siparişte kartta 🎉 notu görünür. Deneme süresince kampanya Salı günleri de geçerlidir.
          </p>
        </Section>

        <Section id="saatler" title="6. Çalışma saatleri">
          {hours ? (
            <p>
              {brand?.name}: <B>{hours.summary}</B>.
              {hours.minBasketKurus > 0 && <> Minimum sepet: <B>{(hours.minBasketKurus / 100).toLocaleString("tr-TR")} TL</B>.</>}
            </p>
          ) : null}
          <p>
            Kapalıyken sepet gönderen müşteriye çalışma saatleri ve açılış zamanı otomatik yazılır. Açılıştan <B>1 saat önce</B> gelen siparişler ön sipariş olarak alınır; müşteriye açılışta hazırlanacağı söylenir. Bu siparişleri açılışta işleme alın.
          </p>
        </Section>

        <Section id="tablet" title="7. Tablet, ses ve ekran">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <B>Sesi aç</B>: tarayıcı kuralı gereği bir kez basmak gerekir. Tercih cihazda hatırlanır; uygulama yeniden açılınca ekrana bir dokunuş sesi başlatır.
            </li>
            <li>
              <B>Ekranı açık tut</B>: sipariş sayfası açıkken tablet ekranı kararmaz.
            </li>
            <li>
              <B>Diğer markanın yeni siparişinde de çal</B>: örneğin Tandır ekranı açıkken Pide&apos;ye sipariş gelirse de ses çalar ve kırmızı uyarıdaki <B>Geç</B> ile o markaya geçersiniz.
            </li>
            <li>
              Kurulum adımları Siparişler sayfasındaki <B>&quot;📱 Tablete kurulum&quot;</B> bölümünde. Tablet şarjda, sesi açık ve &quot;Rahatsız etmeyin&quot; kapalı olmalı; uygulama önde açık durmalı.
            </li>
            <li>İnternet koparsa &quot;bağlantı yok&quot; ekranı çıkar; bağlantı gelince kendiliğinden devam eder.</li>
          </ul>
        </Section>

        {admin && (
          <Section id="yonetici" title="8. Yönetici işleri">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <B>Ürünler</B>: fiyat, açıklama, görsel. Durum: <B>Aktif</B>, <B>Bugün tükendi</B> (ertesi sabah 05:00&apos;te kendiliğinden geri açılır), <B>Pasif</B> (katalogdan kalkar). Değişiklikler WhatsApp kataloğuna <B>&quot;Meta&apos;ya gönder&quot;</B> ile yansır; ürün satırındaki rozet gönderim durumunu gösterir.
              </li>
              <li>
                <B>Seçenek grupları</B>: porsiyon, acı/acısız gibi müşteriye sepetten sonra sorulan seçimler ve ek ücretleri.
              </li>
              <li>
                <B>Müşteriler</B>: müşteri listesi ve içe aktarma; <B>Değerlendirmeler</B>: teslim sonrası puanlar, düşük puanlı müşteriler aranacaklar listesinde.
              </li>
              <li>
                <B>Raporlar</B>: tarih aralığına göre günlük ciro, ödeme şekli dağılımı, en çok satan ürünler ve saate göre sipariş yoğunluğu.
              </li>
              <li>
                <B>Ayarlar</B>: Saatler ve sepet (çalışma saatleri, minimum sepet), Ödeme şekilleri (indirim oranları), Mesajlar (müşteriye giden tüm metinler ve katalog mesajının görseli), Kanallar ve QR, Markalar, WhatsApp bağlantısı, İşletme/KVKK (gizlilik bilgileri, veri silme talepleri, saklama süreleri), Yedekler (her gece otomatik, indirilebilir).
              </li>
              <li>
                <B>Personel</B>: her çalışana ayrı hesap açın. <B>Kullanıcı</B> rolü yalnız Siparişler, Yazışma ve bu kılavuzu görür; <B>Yönetici</B> her şeyi. Hesabı pasife alınan kişinin oturumu hemen kapanır.
              </li>
              <li>
                Kampanyalar bilerek panelden değil kodda tanımlıdır; yeni kampanya ya da değişiklik için geliştiriciye iletin.
              </li>
            </ul>
          </Section>
        )}
      </main>
    </>
  );
}

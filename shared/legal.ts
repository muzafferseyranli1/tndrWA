export interface PolicySection {
  title: string;
  paragraphs: string[];
}

export interface PolicyInfo {
  legalName: string;
  address: string;
  email: string;
  phone: string;
  verbis: string;
}

export interface PolicyRetention {
  messagesDays: number;
  ordersDays: number;
  ratingsDays: number;
}

/** Gün sayısını okunur süreye çevirir (730 -> "2 yıl", 90 -> "90 gün"). */
export function humanDays(days: number): string {
  if (days >= 365 && days % 365 === 0) return `${days / 365} yıl`;
  if (days >= 60 && days % 30 === 0) return `${days / 30} ay`;
  return `${days} gün`;
}

/**
 * Aydınlatma metni ve gizlilik politikası (6698 sayılı KVKK md. 10). İşletme bilgileri ve saklama süreleri ayarlardan gelir.
 * Metin hazır şablondur: yayımlamadan önce hukuk danışmanınıza göstermeniz önerilir.
 */
export function buildPolicySections(info: PolicyInfo, retention: PolicyRetention): PolicySection[] {
  return [
    {
      title: "1. Veri sorumlusu",
      paragraphs: [
        `Kişisel verileriniz, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") kapsamında veri sorumlusu sıfatıyla ${info.legalName} ("Şirket") tarafından işlenmektedir.`,
        `Adres: ${info.address}`,
        `E-posta: ${info.email} · Telefon: ${info.phone}${info.verbis ? ` · VERBIS sicil no: ${info.verbis}` : ""}`,
      ],
    },
    {
      title: "2. İşlenen kişisel veriler",
      paragraphs: [
        "Sipariş ve iletişim süreçlerinde şu veriler işlenir: ad soyad ya da WhatsApp/Telegram profil adı, telefon numarası, teslimat adresi ve (paylaşırsanız) konum bilgisi, sipariş içeriği ve tutarı, ödeme şekli (kart ya da hesap bilgisi alınmaz), Şirket ile yaptığınız yazışmalar, varsa değerlendirme ve yorumlarınız.",
        "Bu internet sitesinde çerez ile sizi izlemeyiz; yalnızca hangi sayfanın ve butonun kaç kez açıldığına dair kimliksiz sayaçlar tutulur.",
      ],
    },
    {
      title: "3. İşleme amaçları ve hukuki sebepler",
      paragraphs: [
        "Verileriniz; siparişinizi almak, hazırlamak ve teslim etmek, sizinle sipariş durumu hakkında iletişim kurmak, talep ve şikâyetlerinizi yanıtlamak, hizmet kalitesini ölçmek ve yasal yükümlülüklerimizi yerine getirmek amacıyla işlenir.",
        "Hukuki sebepler: sözleşmenin kurulması ve ifası (KVKK md. 5/2-c), hukuki yükümlülüğün yerine getirilmesi (md. 5/2-ç) ve temel hak ve özgürlüklerinize zarar vermemek kaydıyla meşru menfaat (md. 5/2-f). Kampanya ve tanıtım mesajları ancak ayrıca vereceğiniz açık rızanızla gönderilir; rıza vermemeniz siparişinizi etkilemez.",
      ],
    },
    {
      title: "4. Verilerin aktarılması",
      paragraphs: [
        "Siparişlerinizi WhatsApp üzerinden alıyorsanız mesajlarınız, WhatsApp Business Platform'u işleten Meta Platforms'un sunucularında da işlenir. Bu aktarım, kullandığınız mesajlaşma hizmetinin doğası gereğidir ve sözleşmenin ifası kapsamındadır. Teslimat için gerekli bilgiler kurye hizmeti verenlerle, yasal talep halinde yetkili kamu kurumlarıyla paylaşılabilir. Verileriniz satılmaz ve reklam amacıyla üçüncü kişilere verilmez.",
      ],
    },
    {
      title: "5. Saklama süreleri",
      paragraphs: [
        `Yazışma kayıtları ${humanDays(retention.messagesDays)}, sipariş kayıtları ${humanDays(retention.ordersDays)}, değerlendirmeler ${humanDays(retention.ratingsDays)} sonra silinir ya da anonim hale getirilir. Yasal saklama yükümlülüğü gerektiren kayıtlar ilgili mevzuattaki süre boyunca tutulur.`,
      ],
    },
    {
      title: "6. Haklarınız",
      paragraphs: [
        "KVKK md. 11 uyarınca; verilerinizin işlenip işlenmediğini öğrenme, işlenmişse bilgi talep etme, amacına uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı kişileri bilme, eksik ya da yanlış işlenmişse düzeltilmesini isteme, silinmesini ya da yok edilmesini isteme, bu işlemlerin aktarıldığı üçüncü kişilere bildirilmesini isteme, otomatik sistemlerle analiz edilmesi sonucu aleyhinize bir sonuç çıkmasına itiraz etme ve kanuna aykırı işleme nedeniyle zarara uğramanız halinde zararın giderilmesini talep etme haklarına sahipsiniz.",
        `Başvurularınızı ${info.email} adresine yazarak, ${info.address} adresine yazılı olarak ya da veri silme talebi için "Veri silme" sayfamızdaki formu doldurarak iletebilirsiniz. Başvurular en geç otuz gün içinde sonuçlandırılır.`,
      ],
    },
  ];
}

import type { Availability, ProductStatus } from "./availability";

export interface BrandDto {
  id: number;
  code: string;
  name: string;
  metaCatalogId: string | null;
  waSession: string | null;
  waPhoneNumberId: string | null;
  productCount: number;
}

export interface CategoryDto {
  id: number;
  name: string;
}

export interface ProductDto {
  id: number;
  brandId: number;
  /** Aynı yemeğin porsiyonlarını birleştirir (porsiyonsuzda null) */
  groupKey: string | null;
  /** "Yarım", "1,5 Pors."... (porsiyonsuzda null) */
  variantLabel: string | null;
  retailerId: string;
  name: string;
  description: string;
  priceKurus: number;
  priceText: string;
  categoryId: number;
  categoryName: string;
  imageUrl: string | null;
  status: ProductStatus;
  soldOutUntil: string | null;
  availability: Availability;
  sortOrder: number;
  onMeta: boolean;
  metaSyncState: "PENDING" | "SYNCED" | "ERROR";
  metaError: string | null;
  metaSyncedAt: string | null;
}

export interface MetaStatusDto {
  configured: boolean;
  publicBaseUrl: string | null;
  autoSync: boolean;
  counts: { pending: number; synced: number; error: number };
  /** Eşitlemeyi engelleyen eksikler (boşsa eşitleme yapılabilir). */
  blockers: string[];
}

export interface SyncSummaryDto {
  sent: number;
  synced: number;
  failed: number;
  skipped: number;
  errors: { retailerId: string; message: string }[];
}

export type OrderStatusDto = "NEW" | "PREPARING" | "ON_THE_WAY" | "DELIVERED" | "CANCELLED";

export interface OrderDto {
  id: number;
  brandId: number;
  status: OrderStatusDto;
  note: string;
  /** Liste fiyatı toplamı (indirim öncesi) */
  totalKurus: number;
  totalText: string;
  /** AWAITING_PAYMENT | AWAITING_ADDRESS: müşteriden bilgi bekleniyor; READY: personel işleyebilir */
  stage: "AWAITING_PAYMENT" | "AWAITING_ADDRESS" | "READY";
  paymentLabel: string;
  discountPercent: number;
  discountText: string;
  payableText: string;
  address: string;
  mapUrl: string | null;
  createdAt: string;
  paymentTypeId: number | null;
  /** Yalnızca Yeni ve Hazırlanıyor aşamasında personel siparişi düzenleyebilir */
  canEdit: boolean;
  /** Personel düzenledi ama müşteriye güncel özet henüz gönderilmedi */
  noticePending: boolean;
  /** Personelin yaptığı değişiklikler, en yeni başta */
  changes: { text: string; createdAt: string }[];
  customer: { name: string | null; phone: string | null };
  items: { id: number; name: string; quantity: number; unitText: string; lineText: string }[];
}

export interface OrderStatusResultDto {
  order: OrderDto;
  /** Müşteriye bildirim gitti mi; gitmediyse sebebi */
  notice: { sent: boolean; error?: string };
}

export interface MessageTemplateDto {
  key: string;
  label: string;
  hint: string;
  text: string;
  defaultText: string;
  isDefault: boolean;
}

export interface ChatConversationDto {
  customerId: number;
  name: string | null;
  phone: string | null;
  lastBody: string;
  lastType: string;
  lastDirection: "IN" | "OUT";
  lastAt: string;
  unread: number;
  /** Müşterinin son mesajından beri 24 saat geçmediyse serbest mesaj gönderilebilir */
  windowOpen: boolean;
}

export interface ChatMessageDto {
  id: number;
  direction: "IN" | "OUT";
  type: string;
  body: string;
  /** IN: RECEIVED | OUT: SENT, DELIVERED, READ, FAILED */
  status: string;
  error: string | null;
  orderId: number | null;
  createdAt: string;
}

export interface ChatThreadDto {
  customer: { id: number; name: string | null; phone: string | null };
  messages: ChatMessageDto[];
  windowOpen: boolean;
  windowEndsAt: string | null;
}

import type { ChannelKind } from "./channels";

export interface PublicBrandDto {
  code: string;
  name: string;
  channels: { kind: ChannelKind; label: string; href: string }[];
}

export interface ChannelDto {
  id: number;
  kind: ChannelKind;
  label: string;
  value: string;
  enabled: boolean;
  valueHint: string;
  valueType: "phone" | "url" | "place";
}

export interface ChannelListDto {
  brandCode: string;
  channels: ChannelDto[];
  landingUrl: string | null;
  brandUrl: string | null;
}

export interface ChannelStatsDto {
  days: number;
  landing: number;
  brandVisits: number;
  clicks: Record<string, number>;
}

export interface PaymentTypeDto {
  id: number;
  name: string;
  discountPercent: number;
  enabled: boolean;
}

export interface RatingContextDto {
  brandName: string;
  /** Bu bağlantıyla zaten değerlendirme yapıldı */
  alreadyRated: boolean;
  /** Bağlantı bir siparişe bağlıysa o siparişin numarası */
  orderNo: number | null;
}

export interface RatingResultDto {
  ok: true;
  low: boolean;
}

export interface RatingDto {
  id: number;
  orderId: number | null;
  taste: number;
  care: number;
  delivery: number;
  comment: string;
  name: string | null;
  phone: string | null;
  low: boolean;
  followUp: "NONE" | "PENDING" | "CALLED" | "RESOLVED";
  followNote: string;
  createdAt: string;
}

export interface RatingSummaryDto {
  days: number;
  count: number;
  lowCount: number;
  pendingCount: number;
  avgTaste: number | null;
  avgCare: number | null;
  avgDelivery: number | null;
}

export interface CustomerDto {
  id: number;
  name: string | null;
  phone: string | null;
  addressCount: number;
  orderCount: number;
  lastAddress: string | null;
}

export interface CustomerImportJobDto {
  id: string;
  state: "running" | "done" | "failed";
  fileName: string;
  stats: {
    read: number;
    invalidPhone: number;
    duplicateInFile: number;
    created: number;
    existing: number;
    namesFilled: number;
    addressesAdded: number;
    withoutAddress: number;
  };
  error: string | null;
}

export interface BusinessInfoDto {
  legalName: string;
  address: string;
  email: string;
  phone: string;
  verbis: string;
}

export interface RetentionDto {
  messagesDays: number;
  ordersDays: number;
  ratingsDays: number;
}

export interface BusinessSettingsDto {
  info: BusinessInfoDto;
  retention: RetentionDto;
  /** Zorunlu bilgiler (ünvan, adres, e-posta, telefon) dolu: gizlilik sayfaları yayında */
  ready: boolean;
  /** Ünvan/adres panelden girilmemiş; fişten alınan geçici varsayılanlar gösteriliyor */
  provisional: boolean;
  policyUrl: string | null;
  deletionUrl: string | null;
}

export interface LegalDto {
  ready: boolean;
  brandName: string;
  sections: { title: string; paragraphs: string[] }[];
  updatedNote: string;
}

export interface DeletionRequestDto {
  id: number;
  createdAt: string;
  phone: string;
  note: string;
  status: "PENDING" | "DONE" | "REJECTED";
  handledAt: string | null;
  handledNote: string;
  /** Bu telefonla kayıtlı müşteri sayısı */
  matchingCustomers: number;
}

export interface BackupDto {
  dir: string;
  keepDays: number;
  files: { name: string; kind: "db" | "uploads"; sizeBytes: number; createdAt: string }[];
  running: boolean;
  lastError: string | null;
  lastRunAt: string | null;
}

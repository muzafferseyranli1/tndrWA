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
  totalKurus: number;
  totalText: string;
  createdAt: string;
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

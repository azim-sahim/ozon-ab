import type { ChangeLog, DailyMetric, Shop, TestStatus, TestSummary, Variant } from "@/lib/types";

export function asIso(v: unknown): string {
  if (!v) return new Date().toISOString();
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

export function toMillis(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  return new Date(String(v)).getTime();
}

export function addHours(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * 3600000);
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function mapShop(row: {
  id: string;
  name: string;
  is_demo: boolean;
  client_id_enc: string | null;
  perf_client_id_enc?: string | null;
  tax_regime?: string | null;
  tax_rate?: unknown;
  extra_monthly?: unknown;
  created_at: unknown;
}): Shop {
  return {
    id: row.id,
    name: row.name,
    isDemo: Boolean(row.is_demo),
    clientIdHint: row.client_id_enc ? "подключён" : null,
    hasPerformance: Boolean(row.perf_client_id_enc),
    taxRegime: row.tax_regime ?? "usn6",
    taxRate: Number(row.tax_rate ?? 6),
    extraMonthly: Number(row.extra_monthly ?? 0),
    createdAt: asIso(row.created_at),
  };
}

export function mapTest(row: {
  id: string;
  shop_id: string;
  shop_name?: string;
  name: string;
  product_id: string | null;
  offer_id: string | null;
  sku: string | null;
  product_name: string | null;
  product_image: string | null;
  status: string;
  mode: string;
  rotation: string;
  interval_hours: unknown;
  current_variant_id: string | null;
  current_label?: string | null;
  next_switch_at: unknown;
  control_variant_id: string | null;
  winner_id: string | null;
  winner_label?: string | null;
  created_at: unknown;
  started_at: unknown;
  completed_at: unknown;
  variant_count?: unknown;
}): TestSummary {
  return {
    id: row.id,
    shopId: row.shop_id,
    shopName: row.shop_name ?? "",
    name: row.name,
    productId: row.product_id,
    offerId: row.offer_id,
    sku: row.sku,
    productName: row.product_name,
    productImage: row.product_image,
    status: row.status as TestStatus,
    mode: (row.mode as TestSummary["mode"]) ?? "rotate",
    rotation: (row.rotation as TestSummary["rotation"]) ?? "interval",
    intervalHours: Number(row.interval_hours ?? 1),
    currentVariantId: row.current_variant_id,
    currentVariantLabel: row.current_label ?? null,
    nextSwitchAt: row.next_switch_at ? asIso(row.next_switch_at) : null,
    controlVariantId: row.control_variant_id,
    winnerId: row.winner_id,
    winnerLabel: row.winner_label ?? null,
    createdAt: asIso(row.created_at),
    startedAt: row.started_at ? asIso(row.started_at) : null,
    completedAt: row.completed_at ? asIso(row.completed_at) : null,
    variantCount: Number(row.variant_count ?? 0),
  };
}

export function mapVariant(row: {
  id: string;
  test_id: string;
  label: string;
  is_control: boolean;
  title: string;
  description: string;
  images: unknown;
  price: string | null;
  sort_order: number;
}): Variant {
  const images = Array.isArray(row.images)
    ? (row.images as string[])
    : typeof row.images === "string"
      ? (JSON.parse(row.images) as string[])
      : [];
  return {
    id: row.id,
    testId: row.test_id,
    label: row.label,
    isControl: Boolean(row.is_control),
    title: row.title,
    description: row.description,
    images,
    price: row.price,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export function mapMetric(row: {
  id: string;
  test_id: string;
  variant_id: string;
  variant_label?: string;
  day: unknown;
  hits_view: unknown;
  session_view: unknown;
  hits_tocart: unknown;
  ordered_units: unknown;
  revenue: unknown;
  incomplete?: unknown;
  ads_views?: unknown;
  ads_clicks?: unknown;
  ads_carts?: unknown;
  ads_orders?: unknown;
  ads_spend?: unknown;
  ads_revenue?: unknown;
}): DailyMetric {
  const day = typeof row.day === "string" ? row.day.slice(0, 10) : asIso(row.day).slice(0, 10);
  return {
    id: row.id,
    testId: row.test_id,
    variantId: row.variant_id,
    variantLabel: row.variant_label ?? "",
    day,
    hitsView: Number(row.hits_view ?? 0),
    sessionView: Number(row.session_view ?? 0),
    hitsTocart: Number(row.hits_tocart ?? 0),
    orderedUnits: Number(row.ordered_units ?? 0),
    revenue: Number(row.revenue ?? 0),
    incomplete: Boolean(row.incomplete),
    adsViews: Number(row.ads_views ?? 0),
    adsClicks: Number(row.ads_clicks ?? 0),
    adsCarts: Number(row.ads_carts ?? 0),
    adsOrders: Number(row.ads_orders ?? 0),
    adsSpend: Number(row.ads_spend ?? 0),
    adsRevenue: Number(row.ads_revenue ?? 0),
  };
}

export function mapLog(row: {
  id: string;
  shop_id: string | null;
  test_id: string | null;
  product_id: string | null;
  action: string;
  detail: string | null;
  created_at: unknown;
}): ChangeLog {
  return {
    id: row.id,
    shopId: row.shop_id,
    testId: row.test_id,
    productId: row.product_id,
    action: row.action,
    detail: row.detail,
    createdAt: asIso(row.created_at),
  };
}

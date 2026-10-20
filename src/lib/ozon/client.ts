import type { ProductCard } from "@/lib/types";
import {
  addFunnel,
  funnelFromNamed,
  moscowYmd,
  parseMetricVector,
  sanitizeFunnel,
  type Funnel,
} from "@/lib/metrics";

const BASE = "https://api-seller.ozon.ru";

export class OzonApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "OzonApiError";
    this.status = status;
    this.code = code;
  }
}

export type ShopCreds = { clientId: string; apiKey: string };

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

let ozonChain: Promise<void> = Promise.resolve();
let ozonLastAt = 0;

function enqueueOzon<T>(fn: () => Promise<T>): Promise<T> {
  const run = ozonChain.then(async () => {
    const wait = ozonLastAt + 700 - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      ozonLastAt = Date.now();
    }
  });
  ozonChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function ozonRequest<T>(creds: ShopCreds, path: string, body: unknown, attempt = 0): Promise<T> {
  return enqueueOzon(() => ozonRequestOnce<T>(creds, path, body, attempt));
}

async function ozonRequestOnce<T>(creds: ShopCreds, path: string, body: unknown, attempt: number): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Client-Id": creds.clientId,
      "Api-Key": creds.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
  if (res.status === 429 && attempt < 4) {
    const raw = res.headers.get("retry-after");
    const sec = raw ? Number(raw) : NaN;
    await sleep(Number.isFinite(sec) && sec > 0 ? Math.min(45000, sec * 1000) : 4000 * 2 ** attempt);
    return ozonRequestOnce<T>(creds, path, body, attempt + 1);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg =
      (json && typeof json === "object" && "message" in json
        ? String((json as { message: unknown }).message)
        : text) || `Ozon API ${res.status}`;
    throw new OzonApiError(friendly(msg, res.status), res.status);
  }
  return json as T;
}

function friendly(message: string, status: number): string {
  const lower = message.toLowerCase();
  if (status === 401 || status === 403 || lower.includes("api-key") || lower.includes("client-id")) {
    return "Ключи Ozon не приняты. Проверьте Client-Id и Api-Key.";
  }
  if (status === 429) return "Слишком много запросов к Ozon. Подождите минуту.";
  if (lower.includes("token is invalid") || lower.includes("accruals token")) {
    return "Ozon отклонил курсор начислений. Повторите сбор — пагинация исправлена.";
  }
  if (lower.includes("premium") || lower.includes("subscription")) {
    return "Эта аналитика доступна только с Premium Plus.";
  }
  return message || `Ошибка Ozon API (${status})`;
}

function isRateLimit(err: unknown) {
  return err instanceof OzonApiError && err.status === 429;
}
function isPremium(err: unknown) {
  if (!(err instanceof OzonApiError)) return false;
  const m = err.message.toLowerCase();
  return err.status === 403 || m.includes("premium") || m.includes("подписк");
}

type ProductInfoItem = {
  id?: number | string;
  product_id?: number | string;
  offer_id?: string;
  name?: string;
  description?: string;
  images?: string[] | { file_name?: string }[];
  primary_image?: string | string[];
  price?: string;
  old_price?: string;
  marketing_price?: string;
  visible?: boolean;
  sources?: { sku?: number | string }[];
  sku?: number | string;
  skus?: { sku?: number | string }[] | Array<number | string>;
};

function collectSkus(item: ProductInfoItem): string[] {
  const out = new Set<string>();
  if (item.sku) out.add(String(item.sku));
  if (Array.isArray(item.skus)) {
    for (const s of item.skus) {
      if (s && typeof s === "object" && "sku" in s && s.sku) out.add(String(s.sku));
      else if (s) out.add(String(s));
    }
  }
  for (const s of item.sources ?? []) if (s.sku) out.add(String(s.sku));
  return [...out];
}

function imageUrls(item: ProductInfoItem): string[] {
  const out: string[] = [];
  const push = (u: unknown) => {
    if (typeof u === "string" && /^https?:\/\//i.test(u)) out.push(u);
  };
  if (Array.isArray(item.primary_image)) item.primary_image.forEach(push);
  else push(item.primary_image);
  if (Array.isArray(item.images)) {
    for (const img of item.images) {
      if (typeof img === "string") push(img);
      else if (img && typeof img === "object" && "file_name" in img) push(img.file_name);
    }
  }
  return [...new Set(out)];
}

function mapProduct(item: ProductInfoItem): ProductCard {
  const skus = collectSkus(item);
  return {
    productId: String(item.id ?? item.product_id ?? ""),
    offerId: item.offer_id ?? "",
    sku: skus[0] ?? null,
    skus,
    name: item.name ?? "",
    description: item.description ?? "",
    images: imageUrls(item),
    price: item.marketing_price ?? item.price ?? null,
    oldPrice: item.old_price ?? null,
    visible: item.visible !== false,
  };
}

function productInfoItems(data: { items?: ProductInfoItem[]; result?: { items?: ProductInfoItem[] } }) {
  return data.result?.items ?? data.items ?? [];
}

export async function validateCredentials(creds: ShopCreds): Promise<void> {
  await ozonRequest(creds, "/v3/product/list", { filter: { visibility: "ALL" }, limit: 1, last_id: "" });
}

async function infoByIds(creds: ShopCreds, productIds: number[], offerIds: string[], skus: number[]) {
  const info = await ozonRequest<{ items?: ProductInfoItem[]; result?: { items?: ProductInfoItem[] } }>(
    creds,
    "/v3/product/info/list",
    { product_id: productIds, offer_id: offerIds, sku: skus },
  );
  return productInfoItems(info)
    .map(mapProduct)
    .filter((p) => p.productId);
}

export async function listProducts(creds: ShopCreds, query?: string): Promise<ProductCard[]> {
  const q = query?.trim();
  if (q && /^\d+$/.test(q)) {
    const found = await infoByIds(creds, [Number(q)], [], [Number(q)]);
    if (found.length) return found;
  }
  if (q) {
    try {
      const found = await infoByIds(creds, [], [q], []);
      if (found.length) return found;
    } catch {
      /* list */
    }
  }
  const details: ProductCard[] = [];
  let lastId = "";
  for (let page = 0; page < 4; page += 1) {
    const data = await ozonRequest<{ result?: { items?: { product_id?: number }[]; last_id?: string } }>(
      creds,
      "/v3/product/list",
      { filter: { visibility: "ALL" }, limit: 100, last_id: lastId },
    );
    const chunk = data.result?.items ?? [];
    const ids = chunk.map((i) => i.product_id).filter((id): id is number => Boolean(id));
    if (ids.length) details.push(...(await infoByIds(creds, ids, [], [])));
    lastId = data.result?.last_id ?? "";
    if (!lastId || chunk.length < 100) break;
  }
  const needle = q?.toLowerCase();
  if (!needle) return details;
  return details.filter(
    (p) =>
      p.name.toLowerCase().includes(needle) ||
      p.offerId.toLowerCase().includes(needle) ||
      p.productId.includes(needle) ||
      p.skus.some((s) => s.includes(needle)) ||
      (p.sku && p.sku.includes(needle)),
  );
}

export async function productsBySkus(creds: ShopCreds, skus: string[]): Promise<ProductCard[]> {
  const nums = [...new Set(skus.map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0))];
  const out: ProductCard[] = [];
  for (let i = 0; i < nums.length; i += 80) {
    try {
      out.push(...(await infoByIds(creds, [], [], nums.slice(i, i + 80))));
    } catch {
      /* skip chunk */
    }
  }
  return out;
}

export async function getProductDetails(creds: ShopCreds, productId: string): Promise<ProductCard> {
  const items = await infoByIds(creds, [Number(productId)], [], []);
  const card = items[0];
  if (!card) throw new OzonApiError("Товар не найден в кабинете Ozon", 404);
  try {
    const desc = await ozonRequest<{ result?: { description?: string }[]; items?: { description?: string }[] }>(
      creds,
      "/v1/product/info/description",
      { product_id: Number(productId) },
    );
    const d = desc.result?.[0]?.description ?? desc.items?.[0]?.description;
    if (d) card.description = d;
  } catch {
    /* optional */
  }
  return card;
}

export async function applyPictures(creds: ShopCreds, productId: string, images: string[]): Promise<void> {
  const urls = images.map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
  if (!urls.length) throw new OzonApiError("Нет публичных URL изображений", 400);
  const id = Number(productId);
  await ozonRequest(creds, "/v1/product/pictures/import", {
    product_id: id,
    images: urls,
  });
}

export async function applyPrices(creds: ShopCreds, productId: string, price: string): Promise<void> {
  await ozonRequest(creds, "/v1/product/import/prices", {
    prices: [{ product_id: Number(productId), price: String(price), auto_action_enabled: "UNKNOWN" }],
  });
}

const NAME_ATTR = 4180;
const DESC_ATTR = 4191;

type ProductAttribute = { id?: number; complex_id?: number; values?: { dictionary_value_id?: number; value?: string }[] };

async function productAttributes(creds: ShopCreds, productId: string, offerId: string): Promise<ProductAttribute[]> {
  const data = await ozonRequest<{ result?: { attributes?: ProductAttribute[] }[] }>(creds, "/v4/product/info/attributes", {
    filter: {
      product_id: [Number(productId)],
      offer_id: offerId ? [offerId] : [],
      visibility: "ALL",
    },
    limit: 1,
    sort_dir: "ASC",
  });
  return data.result?.[0]?.attributes ?? [];
}

/**
 * Меняет только название и аннотацию. Полный /v3/product/import не вызывается: он затирает характеристики.
 * Название на Ozon — это атрибут категории (id 4180), а не поле товара: его id зависит от описание листа
 * (type_id), поэтому id берём из атрибутов самой карточки, а не по константе.
 */
export async function applyNameDescription(
  creds: ShopCreds,
  snapshot: ProductCard,
  title: string,
  description: string,
  which: { title: boolean; description: boolean },
): Promise<void> {
  const attrs = await productAttributes(creds, snapshot.productId, snapshot.offerId);
  const ids = new Set<number>();
  for (const attr of attrs) if (attr.id) ids.add(attr.id);
  const pick = (preferred: number): number | null => {
    if (ids.has(preferred)) return preferred;
    // В редких категориях название хранится в атрибуте с другим id (свой описание лист).
    const alt = [...ids].find((id) => id >= 21000 && id < 22000);
    return alt ?? null;
  };
  const attributes: ProductAttribute[] = [];
  if (which.title) {
    const id = pick(NAME_ATTR);
    if (id === null) throw new OzonApiError("В карточке нет атрибута названия — Ozon не примет смену заголовка", 400);
    attributes.push({ id, complex_id: 0, values: [{ dictionary_value_id: 0, value: title }] });
  }
  if (which.description) {
    if (!ids.has(DESC_ATTR)) throw new OzonApiError("В карточке нет атрибута аннотации — включите «Аннотация» в свойствах шаблона или используйте /v1/product/description/update", 400);
    attributes.push({ id: DESC_ATTR, complex_id: 0, values: [{ dictionary_value_id: 0, value: description }] });
  }
  if (!attributes.length) return;
  const body: Record<string, unknown> = {
    // /v1/product/attributes/update принимает либо product_id, либо offer_id — не пустой offer_id у карточек без артикула
    ...(snapshot.productId ? { product_id: Number(snapshot.productId) } : {}),
    items: [{ offer_id: snapshot.offerId || undefined, product_id: snapshot.productId ? Number(snapshot.productId) : undefined, attributes }],
  };
  const res = await ozonRequest<{ result?: unknown; errors?: unknown[] } & { task_id?: number }>(creds, "/v1/product/attributes/update", body);
  void res;
}

export type AnalyticsRow = { day: string; sku: string | null } & Funnel;

const VIEW_METRICS = ["hits_view", "hits_tocart", "session_view"] as const;
const ORDER_METRICS = ["ordered_units", "revenue"] as const;

type AnalyticsPayload = {
  result?: { data?: { dimensions?: { id?: string; name?: string }[]; metrics?: unknown }[] };
  data?: { dimensions?: { id?: string; name?: string }[]; metrics?: unknown }[];
};

function parseAnalyticsPayload(data: AnalyticsPayload, metrics: readonly string[], fallbackDay: string): AnalyticsRow[] {
  const rows = data.result?.data ?? data.data ?? [];
  const out: AnalyticsRow[] = [];
  for (const row of rows) {
    const dims = row.dimensions ?? [];
    if (!dims.length) continue;
    let day = fallbackDay;
    let sku: string | null = null;
    for (const d of dims) {
      const id = String(d.id ?? "");
      const name = (d.name ?? "").toLowerCase();
      if (name === "day" || /^\d{4}-\d{2}-\d{2}/.test(id)) day = id.slice(0, 10);
      else if (name === "sku" || name === "spu" || (id && !/^\d{4}-\d{2}-\d{2}/.test(id))) sku = id;
    }
    const named = parseMetricVector(row.metrics, metrics);
    if (!named) continue;
    out.push({ day, sku, ...sanitizeFunnel(funnelFromNamed(named)) });
  }
  return out;
}

async function analyticsQuery(
  creds: ShopCreds,
  opts: { dateFrom: string; dateTo: string; metrics: readonly string[]; skus: string[] },
): Promise<AnalyticsRow[]> {
  const filters = opts.skus.length === 1 ? [{ key: "sku", operation: "EQ", value: opts.skus[0] }] : [];
  const data = await ozonRequest<AnalyticsPayload>(creds, "/v1/analytics/data", {
    date_from: opts.dateFrom,
    date_to: opts.dateTo,
    metrics: [...opts.metrics],
    dimension: ["day", "sku"],
    filters,
    sort: [],
    limit: 1000,
    offset: 0,
  });
  let rows = parseAnalyticsPayload(data, opts.metrics, opts.dateFrom);
  if (opts.skus.length) rows = rows.filter((r) => !r.sku || opts.skus.includes(r.sku));
  return rows;
}

export async function fetchAnalytics(
  creds: ShopCreds,
  opts: { dateFrom: string; dateTo: string; skus?: string[] },
): Promise<{ rows: AnalyticsRow[]; limited: boolean; note: string | null; rateLimited: boolean }> {
  const skuList = (opts.skus ?? []).filter(Boolean);
  if (!skuList.length) {
    return { rows: [], limited: true, rateLimited: false, note: "Нет SKU — заказы ищем по offer_id в отгрузках." };
  }
  const byKey = new Map<string, AnalyticsRow>();
  const merge = (row: AnalyticsRow) => {
    const key = `${row.day}:${row.sku ?? ""}`;
    const prev = byKey.get(key);
    byKey.set(key, prev ? { ...row, ...addFunnel(prev, row), day: row.day, sku: row.sku } : row);
  };
  try {
    (await analyticsQuery(creds, { ...opts, metrics: ORDER_METRICS, skus: skuList })).forEach(merge);
  } catch (err) {
    if (isRateLimit(err)) {
      return { rows: [], limited: true, rateLimited: true, note: "Ozon ограничил частоту. Подождите минуту." };
    }
    throw err;
  }
  let limited = false;
  let note: string | null = null;
  try {
    (await analyticsQuery(creds, { ...opts, metrics: VIEW_METRICS, skus: skuList })).forEach(merge);
  } catch (err) {
    if (isRateLimit(err)) note = "Заказы получены. Показы не успели из‑за лимита.";
    else if (isPremium(err) || (err instanceof OzonApiError && (err.status === 400 || err.status === 403))) {
      limited = true;
      note = "Показы и корзина — Premium Plus. Заказы и выручка без подписки.";
    } else note = err instanceof Error ? err.message : "Показы недоступны";
  }
  return { rows: [...byKey.values()].map((r) => ({ ...r, ...sanitizeFunnel(r) })), limited, rateLimited: false, note };
}

type PostingProduct = {
  sku?: number | string;
  offer_id?: string;
  quantity?: number | string;
  price?: string | number;
};
type FinancialProduct = {
  product_id?: number | string;
  sku?: number | string;
  offer_id?: string;
  quantity?: number | string;
  price?: string | number;
};
type Posting = {
  posting_number?: string;
  in_process_at?: string;
  created_at?: string;
  processed_at?: string;
  products?: PostingProduct[];
  financial_data?: { products?: FinancialProduct[] };
};

function pieceCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function listPostings(creds: ShopCreds, path: string, since: string, to: string): Promise<Posting[]> {
  const all: Posting[] = [];
  for (let offset = 0; offset < 300; offset += 100) {
    const data = await ozonRequest<{ result?: { postings?: Posting[] } | Posting[]; postings?: Posting[] }>(creds, path, {
      dir: "ASC",
      filter: { since, to },
      limit: 100,
      offset,
      with: { analytics_data: false, financial_data: true },
    });
    const chunk = Array.isArray(data.result) ? data.result : data.result?.postings ?? data.postings ?? [];
    all.push(...chunk);
    if (chunk.length < 100) break;
  }
  return all;
}

/** Штуки из отгрузок FBS/FBO, не число заказов. Аналитика часто считает заказ как 1. */
export async function fetchOrderMetrics(
  creds: ShopCreds,
  opts: { dateFrom: string; dateTo: string; skus?: string[]; offerId?: string | null },
): Promise<AnalyticsRow[]> {
  const since = `${opts.dateFrom}T00:00:00+03:00`;
  const to = `${opts.dateTo}T23:59:59+03:00`;
  let postings: Posting[] = [];
  for (const path of ["/v3/posting/fbs/list", "/v3/posting/fbo/list", "/v2/posting/fbo/list"]) {
    try {
      postings = postings.concat(await listPostings(creds, path, since, to));
    } catch {
      /* scheme unused */
    }
  }
  const skuSet = new Set((opts.skus ?? []).filter(Boolean));
  const offer = opts.offerId?.trim() ?? "";
  if (!skuSet.size && !offer) return [];
  const byDay = new Map<string, { orderedUnits: number; revenue: number }>();
  const seen = new Set<string>();
  for (const p of postings) {
    if (p.posting_number) {
      if (seen.has(p.posting_number)) continue;
      seen.add(p.posting_number);
    }
    const stamp = p.in_process_at ?? p.processed_at ?? p.created_at ?? opts.dateFrom;
    const day = moscowYmd(new Date(stamp));
    const financial = p.financial_data?.products ?? [];
    for (const [index, prod] of (p.products ?? []).entries()) {
      const sku = prod.sku !== undefined ? String(prod.sku) : "";
      const off = prod.offer_id ?? "";
      const fin = financial[index];
      const finSku = fin?.sku !== undefined ? String(fin.sku) : fin?.product_id !== undefined ? String(fin.product_id) : "";
      const finOffer = fin?.offer_id ?? "";
      const match =
        (sku && skuSet.has(sku)) ||
        (finSku && skuSet.has(finSku)) ||
        (offer && (off === offer || finOffer === offer));
      if (!match) continue;
      const qty = Math.max(pieceCount(prod.quantity), pieceCount(fin?.quantity));
      if (!qty) continue;
      const price = Number(prod.price ?? fin?.price ?? 0) || 0;
      const cur = byDay.get(day) ?? { orderedUnits: 0, revenue: 0 };
      cur.orderedUnits += qty;
      cur.revenue += qty * price;
      byDay.set(day, cur);
    }
  }
  return [...byDay.entries()].map(([day, v]) => ({
    day,
    sku: opts.skus?.[0] ?? null,
    hitsView: 0,
    sessionView: 0,
    hitsTocart: 0,
    orderedUnits: v.orderedUnits,
    revenue: v.revenue,
  }));
}

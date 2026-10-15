export type Shop = {
  id: string;
  name: string;
  isDemo: boolean;
  clientIdHint: string | null;
  hasPerformance: boolean;
  taxRegime: string;
  taxRate: number;
  extraMonthly: number;
  createdAt: string;
};

export type ProductCard = {
  productId: string;
  offerId: string;
  sku: string | null;
  skus: string[];
  name: string;
  description: string;
  images: string[];
  price: string | null;
  oldPrice: string | null;
  visible: boolean;
};

export type TestStatus = "draft" | "running" | "paused" | "completed";
export type TestMode = "rotate" | "analysis_only";
export type RotationMode = "sequential" | "interval";

export type Variant = {
  id: string;
  testId: string;
  label: string;
  isControl: boolean;
  title: string;
  description: string;
  images: string[];
  price: string | null;
  sortOrder: number;
};

export type TestSummary = {
  id: string;
  shopId: string;
  shopName: string;
  name: string;
  productId: string | null;
  offerId: string | null;
  sku: string | null;
  productName: string | null;
  productImage: string | null;
  status: TestStatus;
  mode: TestMode;
  rotation: RotationMode;
  intervalHours: number;
  currentVariantId: string | null;
  currentVariantLabel: string | null;
  nextSwitchAt: string | null;
  controlVariantId: string | null;
  winnerId: string | null;
  winnerLabel: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  variantCount: number;
};

export type DailyMetric = {
  id: string;
  testId: string;
  variantId: string;
  variantLabel: string;
  day: string;
  hitsView: number;
  sessionView: number;
  hitsTocart: number;
  orderedUnits: number;
  revenue: number;
  incomplete: boolean;
  adsViews: number;
  adsClicks: number;
  adsCarts: number;
  adsOrders: number;
  adsSpend: number;
  adsRevenue: number;
};

export type VariantStats = {
  variant: Variant;
  hitsView: number;
  sessionView: number;
  hitsTocart: number;
  orderedUnits: number;
  revenue: number;
  cr: number;
  incompleteUnits: number;
  adsViews: number;
  adsClicks: number;
  adsCarts: number;
  adsOrders: number;
  adsSpend: number;
  adsRevenue: number;
  adsCtr: number;
};

export type Significance = {
  winnerLabel: string | null;
  pValue: number | null;
  ready: boolean;
  note: string;
};

export type AdsSummary = {
  status: "unconfigured" | "empty" | "ok" | "error";
  note: string;
  campaigns: number;
  views: number;
  clicks: number;
  carts: number;
  orders: number;
  spend: number;
  revenue: number;
  ctr: number;
};

export type TestDetail = {
  test: TestSummary;
  variants: Variant[];
  metrics: DailyMetric[];
  stats: VariantStats[];
  significance: Significance;
  snapshot: ProductCard | null;
  analyticsNote: string | null;
  collectMessage?: string;
  ads: AdsSummary;
};

export type ChangeLog = {
  id: string;
  shopId: string | null;
  testId: string | null;
  productId: string | null;
  action: string;
  detail: string | null;
  createdAt: string;
};

export type SkuCost = {
  sku: string;
  offerId: string | null;
  name: string | null;
  image: string | null;
  cost: number;
  packing: number;
};

export type ProfitSkuRow = {
  sku: string;
  name: string;
  image: string | null;
  units: number;
  revenue: number;
  commission: number;
  logistics: number;
  returns: number;
  storage: number;
  penalties: number;
  otherHold: number;
  payout: number;
  ads: number;
  cogs: number;
  extra: number;
  tax: number;
  profit: number;
  margin: number | null;
  roi: number | null;
  drr: number | null;
  missingCost: boolean;
  realization: number;
};

export type ProfitReport = {
  shopId: string;
  shopName: string;
  from: string;
  to: string;
  taxRegime: string;
  taxRate: number;
  extraMonthly: number;
  adsNote: string;
  ozonFinance: { revenue: number; payout: number; paid: number } | null;
  totals: ProfitSkuRow;
  rows: ProfitSkuRow[];
  missingCostCount: number;
};

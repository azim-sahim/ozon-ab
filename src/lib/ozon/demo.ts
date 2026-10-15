import type { ProductCard } from "@/lib/types";

export const DEMO_PRODUCTS: ProductCard[] = [
  {
    productId: "9001001",
    offerId: "UAZ-FILTER-COVER-01",
    sku: "180011001",
    skus: ["180011001"],
    name: "Чехол фильтра салона UAZ Patriot",
    description: "Плотный чехол на корпус салонного фильтра.",
    images: ["https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=900&q=80"],
    price: "890",
    oldPrice: "1190",
    visible: true,
  },
  {
    productId: "9001002",
    offerId: "NIVA-CUP-01",
    sku: "180011002",
    skus: ["180011002"],
    name: "Подстаканник в тоннель Niva",
    description: "Металлический держатель двух стаканов.",
    images: ["https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=900&q=80"],
    price: "1290",
    oldPrice: null,
    visible: true,
  },
];

export function filterDemoProducts(query?: string): ProductCard[] {
  const q = query?.trim().toLowerCase();
  if (!q) return DEMO_PRODUCTS;
  return DEMO_PRODUCTS.filter(
    (p) => p.name.toLowerCase().includes(q) || p.offerId.toLowerCase().includes(q) || p.productId.includes(q),
  );
}

export function demoDaily(variantLabel: string, dayIndex: number, seed = 1) {
  const base = 90 + ((seed * 17 + dayIndex * 13) % 70);
  const boost = variantLabel === "B" ? 1.18 : 1;
  const hitsView = Math.round(base * boost);
  const sessionView = Math.round(hitsView * 0.72);
  const hitsTocart = Math.max(1, Math.round(hitsView * (variantLabel === "B" ? 0.071 : 0.054)));
  const orderedUnits = Math.max(0, Math.round(hitsTocart * 0.32));
  return { hitsView, sessionView, hitsTocart, orderedUnits, revenue: orderedUnits * (890 + seed * 40) };
}

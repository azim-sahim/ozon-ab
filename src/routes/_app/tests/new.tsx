import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { createTest, listShops, searchProducts } from "@/lib/server/actions";
import type { ProductCard } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { ImageGallery } from "@/components/image-gallery";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/tests/new")({ component: NewTest });

function NewTest() {
  const nav = useNavigate();
  const shops = useQuery({ queryKey: ["shops"], queryFn: () => listShops() });
  const [shopId, setShopId] = useState("");
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState<ProductCard | null>(null);
  const [name, setName] = useState("");
  const [intervalHours, setIntervalHours] = useState(24);
  const [titleB, setTitleB] = useState("");
  const [descB, setDescB] = useState("");
  const [imagesA, setImagesA] = useState<string[]>([]);
  const [imagesB, setImagesB] = useState<string[]>([]);
  const found = useMutation({
    mutationFn: () => searchProducts({ data: { shopId, query } }),
    onError: (e: Error) => toast.error(e.message),
  });
  const create = useMutation({
    mutationFn: () => {
      if (!product || !shopId) throw new Error("Выберите товар");
      const a = imagesA.length ? imagesA : product.images;
      const b = imagesB.length ? imagesB : product.images;
      return createTest({
        data: {
          shopId,
          name: name || `A/B ${product.name}`,
          product,
          mode: "rotate",
          rotation: "interval",
          intervalHours,
          variants: [
            { label: "A", title: product.name, description: product.description, images: a, price: product.price, isControl: true },
            { label: "B", title: titleB || product.name, description: descB || product.description, images: b, price: product.price },
          ],
        },
      });
    },
    onSuccess: (r) => {
      toast.success("Тест создан");
      void nav({ to: "/tests/$id", params: { id: r.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const shopList = shops.data ?? [];
  const activeShop = shopId || shopList[0]?.id || "";
  useMemo(() => {
    if (!shopId && shopList[0]) setShopId(shopList[0].id);
  }, [shopId, shopList]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-medium tracking-tight">Новый тест</h1>
      <Card className="space-y-3">
        <Label>Магазин</Label>
        <select
          className="h-10 w-full rounded-[var(--radius-sm)] border border-border bg-elevated px-3 text-sm"
          value={activeShop}
          onChange={(e) => setShopId(e.target.value)}
        >
          {shopList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Label>Товар (offer_id, SKU или название)</Label>
        <div className="flex gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="offer_id или название" />
          <Button variant="secondary" disabled={!activeShop || found.isPending} onClick={() => { setShopId(activeShop); found.mutate(); }}>
            Найти
          </Button>
        </div>
        <div className="grid gap-2">
          {(found.data ?? []).slice(0, 8).map((p) => (
            <button
              key={p.productId}
              type="button"
              onClick={() => {
                setProduct(p);
                setName(`A/B ${p.name}`);
                setTitleB(p.name);
                setDescB(p.description);
                setImagesA(p.images);
                setImagesB(p.images);
              }}
              className="flex items-center gap-3 rounded-[var(--radius-md)] border border-border p-3 text-left hover:bg-elevated"
            >
              {p.images[0] ? <img src={p.images[0]} alt="" className="h-12 w-12 rounded object-cover" /> : null}
              <span>
                <span className="block font-medium">{p.name}</span>
                <span className="text-xs text-subtle">{p.offerId} · SKU {p.sku ?? "—"}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>
      {product ? (
        <Card className="space-y-4">
          <p className="font-medium">Вариант B против текущей карточки A</p>
          <Label>Название теста</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <Label>Интервал смены, часов</Label>
          <Input type="number" min={1} value={intervalHours} onChange={(e) => setIntervalHours(Number(e.target.value) || 24)} />
          <ImageGallery label="Фото варианта A" urls={imagesA} onChange={setImagesA} />
          <Label>Название B</Label>
          <Input value={titleB} onChange={(e) => setTitleB(e.target.value)} />
          <Label>Описание B</Label>
          <Textarea value={descB} onChange={(e) => setDescB(e.target.value)} />
          <ImageGallery label="Фото варианта B" urls={imagesB} onChange={setImagesB} />
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            Создать
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

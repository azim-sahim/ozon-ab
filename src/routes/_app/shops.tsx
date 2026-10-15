import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteShop, listShops, saveShop } from "@/lib/server/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/shops")({ component: ShopsPage });

function ShopsPage() {
  const qc = useQueryClient();
  const shops = useQuery({ queryKey: ["shops"], queryFn: () => listShops() });
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [perfClientId, setPerfClientId] = useState("");
  const [perfClientSecret, setPerfClientSecret] = useState("");
  const save = useMutation({
    mutationFn: () =>
      saveShop({
        data: { id: editId ?? undefined, name, clientId, apiKey, perfClientId, perfClientSecret },
      }),
    onSuccess: () => {
      toast.success(editId ? "Ключи обновлены" : "Магазин сохранён");
      setEditId(null);
      setName("");
      setClientId("");
      setApiKey("");
      setPerfClientId("");
      setPerfClientSecret("");
      void qc.invalidateQueries({ queryKey: ["shops"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const demo = useMutation({
    mutationFn: () => saveShop({ data: { name: name || "Демо-магазин", demo: true } }),
    onSuccess: () => {
      toast.success("Демо подключено");
      void qc.invalidateQueries({ queryKey: ["shops"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteShop({ data: id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["shops"] }),
  });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        <h1 className="text-2xl font-medium tracking-tight">Магазины</h1>
        <p className="text-sm text-muted">
          Seller API — товары и заказы. Performance API — показы и клики рекламы, отдельные ключи.
        </p>
        {(shops.data ?? []).map((s) => (
          <Card key={s.id} className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">{s.name}</p>
              <p className="text-xs text-subtle">
                {s.isDemo ? "демо" : s.clientIdHint ?? "ключи сохранены"}
                {!s.isDemo ? (s.hasPerformance ? " · реклама подключена" : " · нет Performance API") : ""}
              </p>
            </div>
            <div className="flex gap-1">
              {!s.isDemo ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditId(s.id);
                    setName(s.name);
                    setClientId("");
                    setApiKey("");
                    setPerfClientId("");
                    setPerfClientSecret("");
                  }}
                >
                  Ключи
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => remove.mutate(s.id)}>
                Удалить
              </Button>
            </div>
          </Card>
        ))}
        {(shops.data ?? []).length === 0 ? <p className="text-sm text-muted">Добавьте магазин с ключами Seller API.</p> : null}
      </div>
      <Card className="space-y-3">
        <h2 className="text-lg font-medium">{editId ? "Обновить ключи" : "Подключить"}</h2>
        <Label>Название</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Основной кабинет" />
        <Label>Seller Client-Id</Label>
        <Input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
        <Label>Seller Api-Key</Label>
        <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" autoComplete="off" />
        <p className="pt-2 text-xs font-medium uppercase tracking-wide text-subtle">Performance API — реклама</p>
        <p className="text-xs text-muted">
          Кабинет Ozon → Настройки → Seller API → Performance API. Не путать с Api-Key продавца.
        </p>
        <Label>Performance Client ID</Label>
        <Input value={perfClientId} onChange={(e) => setPerfClientId(e.target.value)} autoComplete="off" />
        <Label>Performance Client Secret</Label>
        <Input value={perfClientSecret} onChange={(e) => setPerfClientSecret(e.target.value)} type="password" autoComplete="off" />
        <p className="text-xs text-subtle">Ключи шифруются на сервере и не уходят в браузер.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Проверить и сохранить
          </Button>
          {editId ? (
            <Button
              variant="ghost"
              onClick={() => {
                setEditId(null);
                setName("");
                setClientId("");
                setApiKey("");
                setPerfClientId("");
                setPerfClientSecret("");
              }}
            >
              Отмена
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => demo.mutate()}>
              Демо без ключей
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

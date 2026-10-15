import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { completePasswordReset } from "@/lib/server/password-reset";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (s: Record<string, unknown>) => ({ token: typeof s.token === "string" ? s.token : "" }),
  component: ResetPassword,
});

function ResetPassword() {
  const { token } = Route.useSearch();
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Пароль — минимум 8 символов");
      return;
    }
    if (password !== again) {
      setError("Пароли не совпадают");
      return;
    }
    setBusy(true);
    try {
      await completePasswordReset({ data: { token, password } });
      await nav({ to: "/login" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сменить пароль");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-sm space-y-4 rounded-[var(--radius-xl)] border border-border bg-surface p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-subtle">Seller tools</p>
        <h1 className="text-2xl font-medium tracking-tight">Новый пароль</h1>
        {!token ? (
          <p className="text-sm text-muted">
            В ссылке нет токена.{" "}
            <Link to="/login" className="text-fg underline">
              Запросите сброс снова
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">Придумайте пароль — минимум 8 символов.</p>
            <div>
              <Label>Новый пароль</Label>
              <Input
                className="mt-1"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div>
              <Label>Ещё раз</Label>
              <Input
                className="mt-1"
                type="password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Сохраняем…" : "Сохранить пароль"}
            </Button>
          </>
        )}
        <Link to="/login" className="block text-center text-sm text-muted hover:text-fg">
          К входу
        </Link>
      </form>
    </main>
  );
}

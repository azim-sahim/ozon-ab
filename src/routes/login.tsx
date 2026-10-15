import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { authClient, authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { requestPasswordReset } from "@/lib/server/password-reset";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export const Route = createFileRoute("/login")({ component: Login });

function LoggedInRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    void nav({ to: "/" });
  }, [nav]);
  return <p className="grid min-h-screen place-items-center text-sm text-muted">Уже вошли…</p>;
}

const BEARER_KEY = "grok-auth.bearer-token";

function captureToken(headers: Headers) {
  const token = headers.get("set-auth-token");
  if (!token || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(BEARER_KEY, token);
  } catch {
    /* ignore */
  }
}

function Login() {
  const nav = useNavigate();
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<"in" | "up" | "forgot" | "sent">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isPending) return <p className="grid min-h-screen place-items-center text-sm text-muted">Загрузка…</p>;
  if (user) {
    return <LoggedInRedirect />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const mail = email.trim().toLowerCase();
    if (!mail) {
      setError("Укажите почту");
      return;
    }
    if (mode === "forgot") {
      setBusy(true);
      try {
        const res = await requestPasswordReset({
          data: { email: mail, origin: window.location.origin },
        });
        setResetUrl(res.resetUrl);
        setMode("sent");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось запросить сброс");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!password) {
      setError("Укажите почту и пароль");
      return;
    }
    if (password.length < 8) {
      setError("Пароль — минимум 8 символов");
      return;
    }
    setBusy(true);
    try {
      const fetchOptions = {
        onSuccess: (ctx: { response: Response }) => captureToken(ctx.response.headers),
      };
      if (mode === "up") {
        const { error: err } = await authClient.signUp.email({
          email: mail,
          password,
          name: name.trim() || mail.split("@")[0],
          fetchOptions,
        });
        if (err) throw new Error(err.message || "Не удалось зарегистрироваться");
      } else {
        const { error: err } = await authClient.signIn.email({
          email: mail,
          password,
          fetchOptions,
        });
        if (err) throw new Error(err.message || "Неверная почта или пароль");
      }
      try {
        await authClient.getSession();
      } catch {
        /* session store catches up on next fetch */
      }
      await nav({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === "up" ? "Создайте аккаунт — только почта и пароль."
    : mode === "forgot" ? "Укажите почту — дадим ссылку на новый пароль."
    : mode === "sent" ? "Откройте ссылку и задайте новый пароль. Действует 1 час."
    : "Вход по почте и паролю.";

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-sm space-y-4 rounded-[var(--radius-xl)] border border-border bg-surface p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-subtle">Seller tools</p>
        <h1 className="text-2xl font-medium tracking-tight">Ozon A/B</h1>
        <p className="text-sm text-muted">{title}</p>
        {!authEnabled ? (
          <p className="text-sm text-muted">Вход выключен.</p>
        ) : mode === "sent" ? (
          <>
            {resetUrl ? (
              <a
                href={resetUrl}
                className="block rounded-[var(--radius-sm)] bg-primary px-4 py-2 text-center text-sm font-medium text-primary-fg"
              >
                Задать новый пароль
              </a>
            ) : null}
            <p className="text-xs text-subtle">Ссылку не пересылайте. Если это не ваш аккаунт, просто закройте страницу.</p>
            <button
              type="button"
              className="w-full text-center text-sm text-muted hover:text-fg"
              onClick={() => {
                setMode("in");
                setResetUrl(null);
                setError(null);
              }}
            >
              К входу
            </button>
          </>
        ) : (
          <>
            {mode === "up" ? (
              <div>
                <Label>Имя</Label>
                <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </div>
            ) : null}
            <div>
              <Label>Почта</Label>
              <Input
                className="mt-1"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            {mode !== "forgot" ? (
              <div>
                <Label>Пароль</Label>
                <Input
                  className="mt-1"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "up" ? "new-password" : "current-password"}
                  required
                  minLength={8}
                />
              </div>
            ) : null}
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Секунду…" : mode === "in" ? "Войти" : mode === "up" ? "Зарегистрироваться" : "Получить ссылку"}
            </Button>
            {mode === "in" ? (
              <button
                type="button"
                className="w-full text-center text-sm text-muted hover:text-fg"
                onClick={() => {
                  setMode("forgot");
                  setError(null);
                }}
              >
                Забыли пароль?
              </button>
            ) : null}
            <button
              type="button"
              className="w-full text-center text-sm text-muted hover:text-fg"
              onClick={() => {
                setMode(mode === "forgot" || mode === "up" ? "in" : "up");
                setError(null);
                setResetUrl(null);
              }}
            >
              {mode === "in" ? "Нет аккаунта — регистрация" : "К входу"}
            </button>
          </>
        )}
      </form>
    </main>
  );
}

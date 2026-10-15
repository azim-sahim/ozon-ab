import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { hashPassword } from "better-auth/crypto";

function nid() {
  return crypto.randomUUID();
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function originOf(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.origin;
  } catch {
    return "";
  }
}

export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator((d: { email: string; origin: string }) => d)
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    const origin = originOf(data.origin);
    const token = randomToken();
    const resetUrl = origin ? `${origin}/reset-password?token=${token}` : `/reset-password?token=${token}`;
    if (!email || !email.includes("@")) {
      return { resetUrl };
    }
    const sql = await getSql();
    const users = await sql<{ id: string }>`
      select id from "user" where lower(email) = ${email} limit 1`;
    const userId = users[0]?.id;
    if (!userId) return { resetUrl };
    const recent = await sql<{ n: unknown }>`
      select count(*) as n from password_resets
      where user_id = ${userId} and created_at > now() - interval '15 minutes'`;
    if (Number(recent[0]?.n ?? 0) >= 5) return { resetUrl };
    await sql`delete from password_resets where user_id = ${userId} and used_at is null`;
    await sql`insert into password_resets (id, user_id, token_hash, expires_at)
      values (${nid()}, ${userId}, ${await sha256Hex(token)}, now() + interval '1 hour')`;
    return { resetUrl };
  });

export const completePasswordReset = createServerFn({ method: "POST" })
  .validator((d: { token: string; password: string }) => d)
  .handler(async ({ data }) => {
    const token = data.token.trim();
    const password = data.password;
    if (!token) throw new Error("Нет ссылки сброса. Запросите новую.");
    if (!password || password.length < 8) throw new Error("Пароль — минимум 8 символов");
    const sql = await getSql();
    const rows = await sql<{ id: string; user_id: string }>`
      select id, user_id from password_resets
      where token_hash = ${await sha256Hex(token)}
        and used_at is null
        and expires_at > now()
      limit 1`;
    const row = rows[0];
    if (!row) throw new Error("Ссылка недействительна или истекла. Запросите сброс ещё раз.");
    const hashed = await hashPassword(password);
    const accounts = await sql<{ id: string }>`
      select id from account where "userId" = ${row.user_id} and "providerId" = 'credential' limit 1`;
    if (accounts[0]) {
      await sql`update account set password = ${hashed}, "updatedAt" = now() where id = ${accounts[0].id}`;
    } else {
      await sql`insert into account (
          id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt"
        ) values (
          ${nid()}, ${row.user_id}, 'credential', ${row.user_id}, ${hashed}, now(), now()
        )`;
    }
    await sql`update password_resets set used_at = now() where id = ${row.id}`;
    await sql`delete from password_resets where user_id = ${row.user_id} and id <> ${row.id}`;
    return { ok: true as const };
  });

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatRemaining(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "таймер не задан";
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "смена просрочена";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d} д ${h % 24} ч`;
  if (h > 0) return `${h} ч ${m % 60} мин`;
  return `${Math.max(1, m)} мин`;
}

export function formatCtr(clicks: number, views: number): string {
  if (!views || views <= 0) return "—";
  const pct = (clicks / views) * 100;
  if (!Number.isFinite(pct) || pct < 0) return "—";
  return `${pct.toFixed(pct >= 10 ? 1 : 2).replace(/\.0$/, "")}%`;
}

export function formatMoney(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(v);
}

export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(Math.abs(n) >= 10 ? 0 : 1)}%`;
}

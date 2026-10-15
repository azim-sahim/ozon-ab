import { getSql } from "@/lib/db";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_B64 = Math.ceil((4.5 * 1024 * 1024 * 4) / 3);

export function extForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}

export function publicOrigin(fallback = ""): string {
  const env =
    process.env.APP_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    fallback;
  return (env || "").replace(/\/$/, "");
}

export function publicMediaUrl(origin: string, id: string, mime: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/api/media/${id}.${extForMime(mime)}`;
}

export async function saveMedia(opts: {
  userId: string;
  filename: string;
  mime: string;
  dataBase64: string;
}): Promise<{ id: string; mime: string }> {
  const mime = opts.mime.split(";")[0].trim().toLowerCase();
  if (!ALLOWED.has(mime)) throw new Error("Нужен JPEG, PNG, WebP или GIF");
  const raw = opts.dataBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!raw || raw.length > MAX_B64) throw new Error("Файл слишком большой. Максимум около 4 МБ после сжатия.");
  try {
    Buffer.from(raw, "base64");
  } catch {
    throw new Error("Не удалось прочитать файл");
  }
  const id = crypto.randomUUID();
  const sql = await getSql();
  const filename = (opts.filename || `image.${extForMime(mime)}`).slice(0, 180);
  await sql`insert into media (id, user_id, mime, filename, data_b64)
    values (${id}, ${opts.userId}, ${mime}, ${filename}, ${raw})`;
  return { id, mime };
}

export async function readMedia(id: string): Promise<{ mime: string; filename: string; bytes: Buffer } | null> {
  const clean = id.replace(/\.(jpe?g|png|webp|gif)$/i, "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(clean)) return null;
  const sql = await getSql();
  const rows = await sql<{ mime: string; filename: string; data_b64: string }>`
    select mime, filename, data_b64 from media where id = ${clean}`;
  const row = rows[0];
  if (!row?.data_b64) return null;
  return { mime: row.mime, filename: row.filename, bytes: Buffer.from(row.data_b64, "base64") };
}

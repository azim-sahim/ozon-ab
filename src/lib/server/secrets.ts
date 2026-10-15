type NodeCrypto = typeof import("node:crypto");

function nodeCrypto(): NodeCrypto {
  const proc = globalThis.process as { getBuiltinModule?: (name: string) => NodeCrypto } | undefined;
  if (typeof proc?.getBuiltinModule !== "function") {
    throw new Error("Шифрование ключей доступно только на сервере");
  }
  return proc.getBuiltinModule("crypto");
}

function keyBytes(secret: string): Buffer {
  const { scryptSync } = nodeCrypto();
  return scryptSync(secret, "ozon-ab-shop-keys", 32);
}

function secretsToTry(): string[] {
  const out: string[] = [];
  for (const s of [process.env.BETTER_AUTH_SECRET, process.env.ENCRYPTION_KEY, "ozon-ab-preview-local-key"]) {
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function asText(v: unknown): string {
  if (typeof v === "string") return v.trim().replace(/^\uFEFF/, "").replace(/^"+|"+$/g, "");
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) return v.toString("utf8").trim();
  if (v && typeof v === "object" && Array.isArray((v as { data?: unknown }).data)) {
    return Buffer.from((v as { data: number[] }).data).toString("utf8").trim();
  }
  return String(v ?? "").trim();
}

function looksPlainKey(s: string): boolean {
  if (!s || s.startsWith("v1:") || s.startsWith("v2.")) return false;
  if (s.length < 6 || s.length > 256) return false;
  return /^[A-Za-z0-9._-]+$/.test(s);
}

function decryptV1(packed: string, secret: string): string {
  const { createDecipheriv } = nodeCrypto();
  const parts = packed.split(":");
  if (parts[0] !== "v1" || parts.length < 4) throw new Error("format");
  const ivB = parts[1];
  const tagB = parts[2];
  const dataB = parts.slice(3).join(":");
  if (!ivB || !tagB || !dataB) throw new Error("format");
  const dec = createDecipheriv("aes-256-gcm", keyBytes(secret), Buffer.from(ivB, "base64"));
  dec.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([dec.update(Buffer.from(dataB, "base64")), dec.final()]).toString("utf8");
}

function decryptV2(packed: string, secret: string): string {
  const { createDecipheriv } = nodeCrypto();
  const raw = packed.slice(3);
  const buf = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const dec = createDecipheriv("aes-256-gcm", keyBytes(secret), iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(data), dec.final()]).toString("utf8");
}

export function encryptSecret(plain: string): string {
  const { createCipheriv, randomBytes } = nodeCrypto();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(secretsToTry()[0]!), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, tag, enc]);
  const b64 = blob.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `v2.${b64}`;
}

export function decryptSecret(packedUnknown: unknown): string {
  const packed = asText(packedUnknown);
  if (!packed) throw new Error("Ключи магазина пустые. Заново сохраните Client-Id и Api-Key в разделе «Магазины».");
  if (looksPlainKey(packed)) return packed;

  let last: unknown = null;
  for (const secret of secretsToTry()) {
    try {
      if (packed.startsWith("v2.")) return decryptV2(packed, secret);
      if (packed.startsWith("v1:")) return decryptV1(packed, secret);
    } catch (err) {
      last = err;
    }
  }

  if (!packed.startsWith("v1:") && !packed.startsWith("v2.")) {
    throw new Error("Ключи магазина записаны в старом формате. Откройте «Магазины», заново вставьте Client-Id и Api-Key и сохраните.");
  }
  void last;
  throw new Error("Ключи магазина не читаются после смены сервера. Откройте «Магазины», заново вставьте Client-Id и Api-Key и сохраните.");
}

export function hintClientId(id: string): string {
  if (id.length <= 6) return id;
  return `${id.slice(0, 3)}…${id.slice(-2)}`;
}

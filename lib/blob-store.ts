import { del, get, list, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";

const HISTORY_PREFIX = "history/";
const MAX_SERVER_SIDE_IMAGE_BYTES = 4 * 1024 * 1024;

export type StoredHistoryRecord = {
  id: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function assertBlobConfigured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Penyimpanan Blob belum terhubung.");
  }
}

function recordPath(id: string) {
  const safeId = Buffer.from(id, "utf8").toString("base64url");
  return `${HISTORY_PREFIX}${safeId}.json`;
}

function isStoredHistoryRecord(value: unknown): value is StoredHistoryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredHistoryRecord>;
  return (
    typeof record.id === "string" &&
    !!record.data &&
    typeof record.data === "object" &&
    !Array.isArray(record.data) &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

async function readJsonBlob<T>(pathname: string): Promise<T | null> {
  assertBlobConfigured();
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text) as T;
}

export async function readHistoryRecord(id: string) {
  const value = await readJsonBlob<unknown>(recordPath(id));
  return isStoredHistoryRecord(value) ? value : null;
}

export async function writeHistoryRecord(record: StoredHistoryRecord) {
  assertBlobConfigured();
  await put(recordPath(record.id), JSON.stringify(record), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function deleteHistoryRecord(id: string) {
  assertBlobConfigured();
  await del(recordPath(id));
}

export async function listHistoryRecords(): Promise<StoredHistoryRecord[]> {
  assertBlobConfigured();
  const pathnames: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await list({
      prefix: HISTORY_PREFIX,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    pathnames.push(...page.blobs.map((blob) => blob.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const records: StoredHistoryRecord[] = [];
  const batchSize = 20;
  for (let offset = 0; offset < pathnames.length; offset += batchSize) {
    const batch = pathnames.slice(offset, offset + batchSize);
    const values = await Promise.all(batch.map((pathname) => readJsonBlob<unknown>(pathname)));
    records.push(...values.filter(isStoredHistoryRecord));
  }
  return records;
}

export function proofKeyFromUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/api/proof/")) return null;
  const encodedKey = value.slice("/api/proof/".length).split(/[?#]/, 1)[0];
  try {
    const key = decodeURIComponent(encodedKey);
    if (!key.startsWith("proof_") || key.includes("/") || key.includes("\\")) return null;
    return key;
  } catch {
    return null;
  }
}

export function proofUrl(pathname: string) {
  return `/api/proof/${encodeURIComponent(pathname)}`;
}

export async function putProofImage(pathname: string, bytes: Buffer, contentType: string) {
  assertBlobConfigured();
  await put(pathname, bytes, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType,
  });
}

export async function deletePrivateBlob(pathname: string) {
  assertBlobConfigured();
  await del(pathname);
}

export async function getPrivateBlob(pathname: string) {
  assertBlobConfigured();
  return get(pathname, { access: "private" });
}

export async function storeProofImages(id: string, images: unknown): Promise<string[]> {
  if (images === undefined || images === null) return [];
  if (!Array.isArray(images)) throw new Error("Daftar foto bukti tidak valid.");

  const result: string[] = [];
  for (const image of images) {
    if (typeof image !== "string") throw new Error("Foto bukti tidak valid.");

    if (image.startsWith("/api/proof/")) {
      const key = proofKeyFromUrl(image);
      if (!key) throw new Error("Alamat foto bukti tidak valid.");
      result.push(proofUrl(key));
      continue;
    }

    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i.exec(image);
    if (!match) throw new Error("Format foto bukti tidak didukung.");
    const contentType = match[1].toLowerCase();
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length === 0 || bytes.length > MAX_SERVER_SIDE_IMAGE_BYTES) {
      throw new Error("Foto terlalu besar untuk disimpan. Upload ulang foto dengan ukuran lebih kecil.");
    }

    const extensionByType: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/avif": "avif",
    };
    const extension = extensionByType[contentType] ?? "img";
    const owner = Buffer.from(id, "utf8").toString("base64url").slice(0, 24);
    const pathname = `proof_${owner}_${randomUUID()}.${extension}`;
    await putProofImage(pathname, bytes, contentType);
    result.push(proofUrl(pathname));
  }
  return result;
}

import { randomUUID } from "node:crypto";
import { isSameOrigin } from "@/lib/auth";
import { deletePrivateBlob, proofKeyFromUrl, signatureKeyFromUrl, storeCustomerSignature, storeProofImages, writeHistoryRecord } from "@/lib/blob-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 3_800_000;
const MAX_PHOTO_BYTES = 1_050_000;
const MAX_PHOTOS = 2;
const MAX_SUBMISSIONS_PER_WINDOW = 5;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_RATE_KEYS = 5000;

type RateEntry = { count: number; resetAt: number };
const rateEntries = new Map<string, RateEntry>();

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function clientKey(request: Request) {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 128);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? forwarded.slice(0, 128) : "unknown";
}

function allowSubmission(key: string, now = Date.now()) {
  for (const [candidate, entry] of rateEntries) {
    if (entry.resetAt <= now) rateEntries.delete(candidate);
  }
  let entry = rateEntries.get(key);
  if (!entry || entry.resetAt <= now) {
    if (!entry && rateEntries.size >= MAX_RATE_KEYS) {
      const first = rateEntries.keys().next().value;
      if (first !== undefined) rateEntries.delete(first);
    }
    entry = { count: 0, resetAt: now + WINDOW_MS };
    rateEntries.set(key, entry);
  }
  if (entry.count >= MAX_SUBMISSIONS_PER_WINDOW) return false;
  entry.count += 1;
  return true;
}

async function readBoundedJson(request: Request): Promise<unknown | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) throw new Error("too_large");
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function text(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function jakartaToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatRupiah(digits: string) {
  return `Rp.${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

function validProofImages(value: unknown): value is string[] {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_PHOTOS) return false;
  return value.every((image) => {
    if (typeof image !== "string") return false;
    const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match) return false;
    const encoded = match[2];
    const size = Math.floor((encoded.length * 3) / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
    return size > 0 && size <= MAX_PHOTO_BYTES;
  });
}

function validSignatureImage(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[1], "base64");
  return (
    bytes.length >= 24 && bytes.length <= 250_000 &&
    bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" &&
    bytes.subarray(12, 16).toString("ascii") === "IHDR" &&
    bytes.readUInt32BE(16) >= 100 && bytes.readUInt32BE(16) <= 2000 &&
    bytes.readUInt32BE(20) >= 60 && bytes.readUInt32BE(20) <= 600
  );
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ error: "Permintaan tidak diizinkan." }, 403);
  if (!allowSubmission(clientKey(request))) return json({ error: "Terlalu banyak pengiriman. Coba lagi nanti." }, 429);

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof Error && error.message === "too_large") {
      return json({ error: "Form terlalu besar. Kecilkan foto lalu coba lagi." }, 413);
    }
    return json({ error: "Form tidak dapat dibaca." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Data form tidak valid." }, 400);
  }

  const input = body as Record<string, unknown>;
  const website = text(input.website, 200);
  if (website) return json({ ok: true, reference: "RF-TERKIRIM" }, 201);
  if (input.consent !== true) return json({ error: "Persetujuan pemrosesan data wajib dicentang." }, 400);
  const signatureImage = input.signatureImage;
  if (!validSignatureImage(signatureImage)) return json({ error: "Bubuhkan tanda tangan digital sebelum mengirim." }, 400);

  const name = text(input.name, 100);
  const ktpInput = text(input.ktp, 40).replace(/\D/g, "");
  const accountName = text(input.accountName, 100);
  const bank = text(input.bank, 100);
  const accountNumber = text(input.accountNumber, 32).replace(/[\s-]/g, "");
  const paymentDate = text(input.paymentDate, 10);
  const amountDigits = text(input.amount, 20).replace(/\D/g, "").replace(/^0+/, "");
  const reason = text(input.reason, 500);
  const customerPhone = text(input.customerPhone, 24);
  const phoneDigits = customerPhone.replace(/\D/g, "");
  const proofImages = input.proofImages === undefined ? [] : input.proofImages;

  if (name.length < 2) return json({ error: "Isi nama lengkap." }, 400);
  if (ktpInput && ktpInput.length !== 16) return json({ error: "Nomor KTP harus 16 digit, atau biarkan kosong." }, 400);
  if (accountName.length < 2) return json({ error: "Isi nama pemilik rekening." }, 400);
  if (bank.length < 2) return json({ error: "Isi nama bank." }, 400);
  if (accountNumber.length < 4 || accountNumber.length > 32 || !/^\d+$/.test(accountNumber)) {
    return json({ error: "Nomor rekening harus berisi 4–32 digit." }, 400);
  }
  if (!validDate(paymentDate)) return json({ error: "Pilih tanggal pembayaran yang valid." }, 400);
  if (!amountDigits || amountDigits.length > 15) {
    return json({ error: "Isi nominal pembayaran yang valid." }, 400);
  }
  if (reason.length < 4) return json({ error: "Jelaskan alasan pengajuan refund." }, 400);
  if (phoneDigits.length < 8 || phoneDigits.length > 15 || !/^\+?[0-9\s()-]+$/.test(customerPhone)) {
    return json({ error: "Isi nomor WhatsApp yang dapat dihubungi." }, 400);
  }
  if (!validProofImages(proofImages)) return json({ error: "Lampiran tidak valid; maksimal 2 foto JPG/PNG." }, 400);

  const id = randomUUID();
  const reference = `RF-${id.slice(0, 8).toUpperCase()}`;
  const storedProofs: string[] = [];
  let storedSignatureUrl: string | null = null;
  try {
    storedSignatureUrl = await storeCustomerSignature(id, signatureImage);
    for (const image of proofImages) storedProofs.push(...(await storeProofImages(id, [image])));
    const now = new Date().toISOString();
    await writeHistoryRecord({
      id,
      createdAt: now,
      updatedAt: now,
      data: {
        city: "Jakarta",
        letterDate: jakartaToday(),
        recipientLine: "PT Blue Star Media",
        recipientAddress: "Jl. Tebet Timur Dalam Raya No.76, RT.5/RW.6, Tebet Tim., Kec. Tebet, Kota Jakarta Selatan, Daerah Khusus Ibukota Jakarta 12820",
        name,
        ktp: ktpInput || "-",
        accountName,
        bank,
        accountNumber,
        paymentDate,
        amount: formatRupiah(amountDigits),
        reason,
        closing: "Demikian Surat permohonan ini kami buat dengan sebenar-benarnya agar dapat dipergunakan sebagai mana mestinya.",
        signerName: name,
        customerSignatureImage: storedSignatureUrl,
        proofImages: storedProofs,
        submissionSource: "Portal pelanggan",
        customerPhone,
        customerReference: reference,
        requestStatus: "Menunggu ditinjau",
        customerConsentAt: now,
      },
    });
    return json({ ok: true, reference }, 201);
  } catch {
    const keys = storedProofs.map(proofKeyFromUrl).filter((key): key is string => !!key);
    const signatureKey = signatureKeyFromUrl(storedSignatureUrl);
    if (signatureKey) keys.push(signatureKey);
    await Promise.allSettled(keys.map((key) => deletePrivateBlob(key)));
    return json({ error: "Pengajuan belum dapat disimpan. Coba lagi beberapa saat." }, 500);
  }
}

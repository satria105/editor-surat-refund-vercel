import { requireAuth } from "@/lib/auth";
import { randomUUID } from "node:crypto";
import { mergeHistoryData } from "@/lib/history-data";
import {
  deletePrivateBlob,
  listHistoryRecords,
  proofKeyFromUrl,
  readHistoryRecord,
  signatureKeyFromUrl,
  storeProofImages,
  writeHistoryRecord,
} from "@/lib/blob-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    headers: { "cache-control": "no-store" },
    ...init,
  });
}

export async function GET(request: Request) {
  try {
    const denied = await requireAuth(request);
    if (denied) return denied;
    const records = await listHistoryRecords();
    const query = new URL(request.url).searchParams.get("q")?.trim().toLocaleLowerCase("id") ?? "";
    const items = records
      .map((record) => {
        const data = record.data;
        return {
          id: record.id,
          name: typeof data.name === "string" ? data.name : "",
          letterDate: typeof data.letterDate === "string" ? data.letterDate : "",
          paymentDate: typeof data.paymentDate === "string" ? data.paymentDate : "",
          amount: typeof data.amount === "string" ? data.amount : "",
          submissionSource: typeof data.submissionSource === "string" ? data.submissionSource : "",
          customerPhone: typeof data.customerPhone === "string" ? data.customerPhone : "",
          customerReference: typeof data.customerReference === "string" ? data.customerReference : "",
          hasCustomerSignature: Boolean(signatureKeyFromUrl(data.customerSignatureImage)),
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
      })
      .filter((item) => {
        if (!query) return true;
        return [item.name, item.amount, item.letterDate, item.paymentDate]
          .some((value) => value.toLocaleLowerCase("id").includes(query));
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return json({ items });
  } catch {
    return json({ error: "History belum bisa dibaca. Coba refresh halaman." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const denied = await requireAuth(request);
    if (denied) return denied;
    const body = (await request.json()) as {
      id?: unknown;
      data?: unknown;
      proofImages?: unknown;
    };
    if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
      return json({ error: "Data surat tidak valid." }, { status: 400 });
    }

    const submittedData = body.data as Record<string, unknown>;
    const incomingSignature = submittedData.customerSignatureImage;
    if (
      incomingSignature !== undefined &&
      incomingSignature !== null &&
      incomingSignature !== "" &&
      !signatureKeyFromUrl(incomingSignature)
    ) {
      return json({ error: "Alamat tanda tangan tidak valid." }, { status: 400 });
    }

    const id = typeof body.id === "string" && body.id.length > 0 ? body.id : randomUUID();
    const previous = await readHistoryRecord(id);
    const proofImages = await storeProofImages(id, body.proofImages ?? []);
    const mergedData = mergeHistoryData(previous?.data, submittedData);
    mergedData.proofImages = proofImages;
    const now = new Date().toISOString();
    const record = {
      id,
      data: mergedData,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };

    await writeHistoryRecord(record);

    const retainedKeys = new Set(proofImages.map(proofKeyFromUrl).filter((key): key is string => !!key));
    const oldImages = previous?.data.proofImages;
    if (Array.isArray(oldImages)) {
      const obsoleteKeys = [...new Set(oldImages.map(proofKeyFromUrl).filter((key): key is string => !!key))]
        .filter((key) => !retainedKeys.has(key));
      await Promise.all(obsoleteKeys.map((key) => deletePrivateBlob(key)));
    }
    const previousSignatureKey = signatureKeyFromUrl(previous?.data.customerSignatureImage);
    const retainedSignatureKey = signatureKeyFromUrl(mergedData.customerSignatureImage);
    if (previousSignatureKey && previousSignatureKey !== retainedSignatureKey) {
      await deletePrivateBlob(previousSignatureKey).catch(() => undefined);
    }

    return json({ id, proofImages });
  } catch {
    return json({ error: "Gagal menyimpan history. Coba lagi." }, { status: 500 });
  }
}

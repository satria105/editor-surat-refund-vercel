import {
  deleteHistoryRecord,
  deletePrivateBlob,
  proofKeyFromUrl,
  readHistoryRecord,
} from "@/lib/blob-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    headers: { "cache-control": "no-store" },
    ...init,
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const record = await readHistoryRecord(id);
    if (!record) return json({ error: "History tidak ditemukan." }, { status: 404 });
    return json({ id: record.id, data: record.data });
  } catch {
    return json({ error: "History belum bisa dibaca." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const record = await readHistoryRecord(id);
    const images = record?.data.proofImages;
    if (Array.isArray(images)) {
      const keys = [...new Set(images.map(proofKeyFromUrl).filter((key): key is string => !!key))];
      await Promise.all(keys.map((key) => deletePrivateBlob(key)));
    }
    await deleteHistoryRecord(id);
    return json({ ok: true });
  } catch {
    return json({ error: "Gagal menghapus history." }, { status: 500 });
  }
}

import { getPrivateBlob } from "@/lib/blob-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound() {
  return Response.json(
    { error: "Foto bukti tidak ditemukan." },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await context.params;
    if (!key.startsWith("proof_") || key.includes("/") || key.includes("\\")) return notFound();
    const blob = await getPrivateBlob(key);
    if (!blob || blob.statusCode !== 200) return notFound();

    const contentType = blob.blob.contentType || "application/octet-stream";
    if (!contentType.toLowerCase().startsWith("image/")) return notFound();

    return new Response(blob.stream, {
      headers: {
        "content-type": contentType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "Foto bukti belum bisa dibaca." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

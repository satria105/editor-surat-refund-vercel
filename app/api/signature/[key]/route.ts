import { requireAuth } from "@/lib/auth";
import { getPrivateBlob } from "@/lib/blob-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound() {
  return Response.json(
    { error: "Tanda tangan tidak ditemukan." },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  try {
    const denied = await requireAuth(request);
    if (denied) return denied;
    const { key } = await context.params;
    if (!key.startsWith("signature_") || key.includes("/") || key.includes("\\")) return notFound();
    const blob = await getPrivateBlob(key);
    if (!blob || blob.statusCode !== 200) return notFound();
    const contentType = blob.blob.contentType?.toLowerCase();
    if (contentType !== "image/png") return notFound();
    return new Response(blob.stream, {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "Tanda tangan belum bisa dibaca." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

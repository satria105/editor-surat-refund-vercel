import { requireAuth } from "@/lib/auth";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const denied = await requireAuth(request);
        if (denied) throw new Error("Sesi diperlukan untuk upload foto.");
        if (!pathname.startsWith("proof_") || pathname.includes("/") || pathname.includes("\\")) {
          throw new Error("Nama file foto tidak valid.");
        }
        return {
          allowedContentTypes: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "image/avif",
          ],
          maximumSizeInBytes: 8 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => undefined,
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json(
      { error: "Gagal membuat akses upload foto." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}

import { authError, listAuthAuditEvents, requireRole } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireRole(request, "master");
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const requested = Number(url.searchParams.get("limit") ?? 100);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(200, Math.floor(requested))) : 100;
    const result = await listAuthAuditEvents(limit);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    return authError(500, "Audit login belum dapat dibaca.");
  }
}

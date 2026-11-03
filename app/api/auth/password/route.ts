import {
  authError,
  changeAccountPassword,
  isSameOrigin,
  isValidLoginPassword,
  isValidNewPassword,
  requireRole,
  verifyLoginPassword,
  type AccountRole,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 4096;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return authError(403, "Permintaan tidak diizinkan.");
  const denied = await requireRole(request, "master");
  if (denied) return denied;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) return authError(413, "Permintaan terlalu besar.");
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return authError(400, "Permintaan tidak valid.");
    const input = body as { currentPassword?: unknown; account?: unknown; password?: unknown; confirmPassword?: unknown };
    if (!isValidLoginPassword(input.currentPassword) || !(await verifyLoginPassword("master", input.currentPassword))) {
      return authError(401, "Password Master saat ini tidak cocok.");
    }
    if (input.account !== "admin" && input.account !== "master") return authError(400, "Jenis akun tidak valid.");
    if (!isValidNewPassword(input.password)) return authError(400, "Password baru minimal 12 karakter.");
    if (input.password !== input.confirmPassword) return authError(400, "Konfirmasi password tidak cocok.");
    await changeAccountPassword(request, input.account as AccountRole, input.password);
    return Response.json({ updated: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return authError(500, "Password belum dapat diperbarui.");
  }
}

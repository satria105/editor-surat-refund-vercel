import {
  authError,
  createInitialMasterAccount,
  isSameOrigin,
  isValidLoginPassword,
  isValidNewPassword,
  requireRole,
  verifyLoginPassword,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 4096;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return authError(403, "Permintaan tidak diizinkan.");
  const denied = await requireRole(request, "admin");
  if (denied) return denied;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) return authError(413, "Permintaan terlalu besar.");
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return authError(400, "Permintaan tidak valid.");
    const input = body as { currentPassword?: unknown; password?: unknown; confirmPassword?: unknown };
    if (!isValidLoginPassword(input.currentPassword) || !(await verifyLoginPassword("admin", input.currentPassword))) {
      return authError(401, "Password Admin saat ini tidak cocok.");
    }
    if (!isValidNewPassword(input.password)) return authError(400, "Password baru minimal 12 karakter.");
    if (input.password !== input.confirmPassword) return authError(400, "Konfirmasi password tidak cocok.");
    await createInitialMasterAccount(request, input.password);
    return Response.json({ created: true }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("sudah dibuat") || message.includes("already exists")) return authError(409, "Akun Master sudah dibuat.");
    return authError(500, "Akun Master belum dapat disimpan.");
  }
}

import {
  authError,
  createSession,
  hasMasterAccount,
  isLoginRateLimited,
  isSameOrigin,
  isValidLoginPassword,
  recordAuthEvent,
  revokeCreatedSession,
  sessionCookie,
  verifyLoginPassword,
  type AccountRole,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;

async function readBoundedBody(request: Request): Promise<string | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return authError(403, "Permintaan tidak diizinkan.");
  if (isLoginRateLimited(request)) return authError(429, "Terlalu banyak percobaan. Coba lagi nanti.");

  try {
    const text = await readBoundedBody(request);
    if (text === null) return authError(400, "Permintaan login tidak valid.");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return authError(400, "Permintaan login tidak valid.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return authError(400, "Permintaan login tidak valid.");
    }

    const account = (body as { account?: unknown; password?: unknown }).account ?? "admin";
    const password = (body as { password?: unknown }).password;
    if (account !== "admin" && account !== "master") return authError(400, "Jenis akun tidak valid.");
    const role = account as AccountRole;
    if (!isValidLoginPassword(password)) {
      await recordAuthEvent(request, { action: "login", actor: role, account: role, success: false });
      return authError(401, "Password salah atau akun belum tersedia.");
    }
    if (!(await verifyLoginPassword(role, password))) {
      await recordAuthEvent(request, { action: "login", actor: role, account: role, success: false });
      return authError(401, "Password salah atau akun belum tersedia.");
    }

    const token = await createSession(role);
    try {
      await recordAuthEvent(request, { action: "login", actor: role, account: role, success: true });
    } catch {
      await revokeCreatedSession(token, role).catch(() => undefined);
      return authError(500, "Audit login belum tersedia. Coba lagi.");
    }
    const masterExists = await hasMasterAccount();
    return Response.json(
      { authenticated: true, role, masterExists },
      { status: 200, headers: { "cache-control": "no-store", "set-cookie": sessionCookie(token, false, role) } },
    );
  } catch {
    return authError(500, "Login belum tersedia. Coba lagi.");
  }
}

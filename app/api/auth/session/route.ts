import { authError, getSessionRole, hasMasterAccount } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const role = await getSessionRole(request);
  if (!role) return authError(401, "Authentication required.");
  try {
    const masterExists = await hasMasterAccount();
    return Response.json(
      { authenticated: true, role, masterExists },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return authError(500, "Status akun belum tersedia.");
  }
}

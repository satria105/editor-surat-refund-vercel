import { authError, isSameOrigin, revokeSession, sessionCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return authError(403, "Forbidden.");

  try {
    await revokeSession(request);
    return Response.json(
      { authenticated: false },
      {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "set-cookie": sessionCookie("", true),
        },
      },
    );
  } catch {
    return Response.json(
      { error: "Logout is temporarily unavailable." },
      {
        status: 500,
        headers: {
          "cache-control": "no-store",
          "set-cookie": sessionCookie("", true),
        },
      },
    );
  }
}

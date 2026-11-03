import { hasSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authenticated = await hasSession(request);
  return Response.json(
    { authenticated },
    {
      status: authenticated ? 200 : 401,
      headers: { "cache-control": "no-store" },
    },
  );
}

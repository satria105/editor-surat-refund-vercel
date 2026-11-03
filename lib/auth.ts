import { del, get, put } from "@vercel/blob";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "refund_session";
const SESSION_PREFIX = "auth_sessions/";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_SALT_HEX = "6049be1f42d0eba2d42510531181cbc8";
const PASSWORD_HASH_HEX =
  "323e72e1f33f9d9087378d66172ee8f400931688a29869ac0b36afb58ecb4eb94239ef5cb6bb1af3c4266e18dc68e857dc9bfe064f8f3c0a9f8cf335dea309b8";
const SCRYPT_KEY_BYTES = 64;
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_RATE_LIMIT_ENTRIES = 5000;

type StoredSession = { expiresAt: number };
type RateLimitEntry = { attempts: number; resetAt: number };

const loginAttempts = new Map<string, RateLimitEntry>();

function sessionPath(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return `${SESSION_PREFIX}${tokenHash}.json`;
}

function getSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    const value = item.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  return null;
}

function hasBlobConfiguration() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readSession(token: string): Promise<boolean> {
  if (!hasBlobConfiguration()) return false;

  try {
    const result = await get(sessionPath(token), { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return false;
    const value: unknown = await new Response(result.stream).json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const expiresAt = (value as Partial<StoredSession>).expiresAt;
    return typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > Date.now();
  } catch {
    return false;
  }
}

export async function hasSession(request: Request): Promise<boolean> {
  const token = getSessionToken(request);
  return token ? readSession(token) : false;
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const requestHost = request.headers.get("host") || requestUrl.host;
    return originUrl.host === requestHost && originUrl.protocol === requestUrl.protocol;
  } catch {
    return false;
  }
}

function jsonError(status: number, error: string) {
  return Response.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function requireAuth(request: Request): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const isMutation = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (isMutation && !isSameOrigin(request)) {
    return jsonError(403, "Forbidden.");
  }
  if (!(await hasSession(request))) {
    return jsonError(401, "Authentication required.");
  }
  return null;
}

function clientAddress(request: Request): string {
  const directAddress = request.headers.get("x-real-ip")?.trim();
  if (directAddress) return directAddress.slice(0, 128);
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const addresses = forwarded.split(",").map((address) => address.trim()).filter(Boolean);
    if (addresses.length) return addresses[addresses.length - 1].slice(0, 128);
  }
  return "unknown";
}

function allowLoginAttempt(address: string, now = Date.now()): boolean {
  for (const [key, entry] of loginAttempts) {
    if (entry.resetAt <= now) loginAttempts.delete(key);
  }

  let entry = loginAttempts.get(address);
  if (!entry || entry.resetAt <= now) {
    if (!entry && loginAttempts.size >= MAX_RATE_LIMIT_ENTRIES) {
      const oldestKey = loginAttempts.keys().next().value;
      if (oldestKey !== undefined) loginAttempts.delete(oldestKey);
    }
    entry = { attempts: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(address, entry);
  }

  if (entry.attempts >= MAX_LOGIN_ATTEMPTS) return false;
  entry.attempts += 1;
  return true;
}

function passwordMatches(candidate: string): boolean {
  const expected = Buffer.from(PASSWORD_HASH_HEX, "hex");
  const actual = scryptSync(candidate, Buffer.from(PASSWORD_SALT_HEX, "hex"), SCRYPT_KEY_BYTES);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sessionCookie(token: string, clear = false): string {
  const parts = [
    `${SESSION_COOKIE}=${clear ? "" : token}`,
    "Path=/",
    `Max-Age=${clear ? 0 : Math.floor(SESSION_TTL_MS / 1000)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function isLoginRateLimited(request: Request): boolean {
  return !allowLoginAttempt(clientAddress(request));
}

export async function createSession(): Promise<string> {
  if (!hasBlobConfiguration()) throw new Error("Session storage unavailable");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await put(sessionPath(token), JSON.stringify({ expiresAt }), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json",
  });
  return token;
}

export async function revokeSession(request: Request): Promise<void> {
  const token = getSessionToken(request);
  if (token && hasBlobConfiguration()) await del(sessionPath(token));
}

export function isValidLoginPassword(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

export function verifyLoginPassword(candidate: string): boolean {
  return passwordMatches(candidate);
}

export function authError(status: number, message: string) {
  return jsonError(status, message);
}

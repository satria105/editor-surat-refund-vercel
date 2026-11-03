import { del, get, list, put } from "@vercel/blob";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "refund_session";
const SESSION_PREFIX = "auth_sessions/";
const ACCOUNT_PREFIX = "auth_accounts/";
const AUDIT_PREFIX = "auth_audit/";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const LEGACY_PASSWORD_SALT_HEX = "6049be1f42d0eba2d42510531181cbc8";
const LEGACY_PASSWORD_HASH_HEX =
  "323e72e1f33f9d9087378d66172ee8f400931688a29869ac0b36afb58ecb4eb94239ef5cb6bb1af3c4266e18dc68e857dc9bfe064f8f3c0a9f8cf335dea309b8";
const SCRYPT_KEY_BYTES = 64;
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_RATE_LIMIT_ENTRIES = 5000;

export type AccountRole = "admin" | "master";
type StoredPassword = { version: 1; saltHex: string; hashHex: string; updatedAt: string };
type StoredSession = { expiresAt: number; role?: AccountRole };
type RateLimitEntry = { attempts: number; resetAt: number };
export type AuthAuditEvent = {
  id: string;
  timestamp: string;
  action: "login" | "password_change" | "master_setup";
  actor: AccountRole;
  account: AccountRole;
  success: boolean;
  ip: string;
  userAgent: string;
};

const loginAttempts = new Map<string, RateLimitEntry>();

function hasBlobConfiguration() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sessionPath(token: string, role: AccountRole) {
  return `${SESSION_PREFIX}${role}/${tokenHash(token)}.json`;
}

function legacySessionPath(token: string) {
  return `${SESSION_PREFIX}${tokenHash(token)}.json`;
}

function accountPath(role: AccountRole) {
  return `${ACCOUNT_PREFIX}${role}.json`;
}

function getSessionCookie(request: Request): { token: string; role: AccountRole | null } | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    const value = item.slice(separator + 1).trim();
    const roleMatch = /^(admin|master)\.([A-Za-z0-9_-]{43})$/.exec(value);
    if (roleMatch) return { role: roleMatch[1] as AccountRole, token: roleMatch[2] };
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? { role: null, token: value } : null;
  }
  return null;
}

async function readPrivateJson(pathname: string): Promise<unknown | null> {
  if (!hasBlobConfiguration()) return null;
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  try {
    return await new Response(result.stream).json();
  } catch {
    return null;
  }
}

function isStoredPassword(value: unknown): value is StoredPassword {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<StoredPassword>;
  return record.version === 1 &&
    typeof record.saltHex === "string" && /^[a-f0-9]{32}$/i.test(record.saltHex) &&
    typeof record.hashHex === "string" && /^[a-f0-9]{128}$/i.test(record.hashHex) &&
    typeof record.updatedAt === "string";
}

async function readPasswordRecord(role: AccountRole): Promise<StoredPassword | null> {
  const value = await readPrivateJson(accountPath(role));
  if (value === null) return null;
  if (!isStoredPassword(value)) throw new Error("Data akun tidak valid.");
  return value;
}

function passwordRecord(password: string): StoredPassword {
  const salt = randomBytes(16);
  return {
    version: 1,
    saltHex: salt.toString("hex"),
    hashHex: scryptSync(password, salt, SCRYPT_KEY_BYTES).toString("hex"),
    updatedAt: new Date().toISOString(),
  };
}

function comparePassword(password: string, saltHex: string, hashHex: string): boolean {
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), SCRYPT_KEY_BYTES);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readSessionRecord(pathname: string, assumedRole?: AccountRole) {
  const value = await readPrivateJson(pathname);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<StoredSession>;
  if (typeof record.expiresAt !== "number" || !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now()) {
    return null;
  }
  const role = record.role ?? assumedRole ?? "admin";
  if (role !== "admin" && role !== "master") return null;
  if (assumedRole && record.role && record.role !== assumedRole) return null;
  return role;
}

export async function getSessionRole(request: Request): Promise<AccountRole | null> {
  const cookie = getSessionCookie(request);
  if (!cookie || !hasBlobConfiguration()) return null;

  try {
    if (cookie.role) return await readSessionRecord(sessionPath(cookie.token, cookie.role), cookie.role);
    return await readSessionRecord(legacySessionPath(cookie.token), "admin");
  } catch {
    return null;
  }
}

export async function hasSession(request: Request): Promise<boolean> {
  return (await getSessionRole(request)) !== null;
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
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function requireAuth(request: Request): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const isMutation = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (isMutation && !isSameOrigin(request)) return jsonError(403, "Forbidden.");
  if (!(await hasSession(request))) return jsonError(401, "Authentication required.");
  return null;
}

export async function requireRole(request: Request, role: AccountRole): Promise<Response | null> {
  const method = request.method.toUpperCase();
  const isMutation = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (isMutation && !isSameOrigin(request)) return jsonError(403, "Forbidden.");
  const currentRole = await getSessionRole(request);
  if (!currentRole) return jsonError(401, "Authentication required.");
  if (currentRole !== role) return jsonError(403, "Akses khusus akun Master.");
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

export function isLoginRateLimited(request: Request): boolean {
  return !allowLoginAttempt(clientAddress(request));
}

export function sessionCookie(token: string, clear = false, role?: AccountRole): string {
  const parts = [
    `${SESSION_COOKIE}=${clear ? "" : `${role ? `${role}.` : ""}${token}`}`,
    "Path=/",
    `Max-Age=${clear ? 0 : Math.floor(SESSION_TTL_MS / 1000)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export async function createSession(role: AccountRole): Promise<string> {
  if (!hasBlobConfiguration()) throw new Error("Session storage unavailable");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await put(sessionPath(token, role), JSON.stringify({ expiresAt, role }), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json",
  });
  return token;
}

export async function revokeCreatedSession(token: string, role: AccountRole): Promise<void> {
  if (!hasBlobConfiguration()) return;
  await del(sessionPath(token, role));
}

export async function revokeSession(request: Request): Promise<void> {
  const cookie = getSessionCookie(request);
  if (!cookie || !hasBlobConfiguration()) return;
  const pathname = cookie.role ? sessionPath(cookie.token, cookie.role) : legacySessionPath(cookie.token);
  await del(pathname);
}

export function isValidLoginPassword(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

export function isValidNewPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 256;
}

export async function verifyLoginPassword(role: AccountRole, candidate: string): Promise<boolean> {
  const stored = await readPasswordRecord(role);
  if (stored) return comparePassword(candidate, stored.saltHex, stored.hashHex);
  if (role !== "admin") return false;
  return comparePassword(candidate, LEGACY_PASSWORD_SALT_HEX, LEGACY_PASSWORD_HASH_HEX);
}

export async function hasMasterAccount(): Promise<boolean> {
  return (await readPasswordRecord("master")) !== null;
}

async function savePasswordRecord(role: AccountRole, password: string, allowOverwrite: boolean) {
  if (!hasBlobConfiguration()) throw new Error("Penyimpanan akun belum tersedia.");
  await put(accountPath(role), JSON.stringify(passwordRecord(password)), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite,
    contentType: "application/json",
  });
}

export async function createInitialMasterAccount(request: Request, password: string) {
  if (await hasMasterAccount()) throw new Error("Akun Master sudah dibuat.");
  await savePasswordRecord("master", password, false);
  await recordAuthEvent(request, { action: "master_setup", actor: "admin", account: "master", success: true });
}

async function revokeRoleSessions(role: AccountRole, keepRequest?: Request) {
  if (!hasBlobConfiguration()) return;
  const pageLimit = 1000;
  const paths: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `${SESSION_PREFIX}${role}/`, limit: pageLimit, ...(cursor ? { cursor } : {}) });
    paths.push(...page.blobs.map((blob) => blob.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  if (role === "admin") {
    let legacyCursor: string | undefined;
    do {
      const page = await list({ prefix: SESSION_PREFIX, limit: pageLimit, ...(legacyCursor ? { cursor: legacyCursor } : {}) });
      paths.push(...page.blobs.map((blob) => blob.pathname).filter((pathname) => /^auth_sessions\/[a-f0-9]{64}\.json$/i.test(pathname)));
      legacyCursor = page.hasMore ? page.cursor : undefined;
    } while (legacyCursor);
  }

  const cookie = keepRequest ? getSessionCookie(keepRequest) : null;
  const keepPath = cookie?.role === role ? sessionPath(cookie.token, role) : null;
  await Promise.allSettled([...new Set(paths)].filter((pathname) => pathname !== keepPath).map((pathname) => del(pathname)));
}

export async function changeAccountPassword(request: Request, role: AccountRole, password: string) {
  await savePasswordRecord(role, password, true);
  await revokeRoleSessions(role, request);
  const actor = (await getSessionRole(request)) ?? "master";
  await recordAuthEvent(request, { action: "password_change", actor, account: role, success: true });
}

export async function recordAuthEvent(
  request: Request,
  event: Pick<AuthAuditEvent, "action" | "actor" | "account" | "success">,
) {
  if (!hasBlobConfiguration()) return;
  const timestamp = new Date().toISOString();
  const id = `${Date.now().toString().padStart(13, "0")}-${randomBytes(8).toString("hex")}`;
  const audit: AuthAuditEvent = {
    id,
    timestamp,
    ...event,
    ip: clientAddress(request),
    userAgent: (request.headers.get("user-agent") ?? "unknown").slice(0, 240),
  };
  await put(`${AUDIT_PREFIX}${id}.json`, JSON.stringify(audit), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json",
  });
}

function isAuthAuditEvent(value: unknown): value is AuthAuditEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Partial<AuthAuditEvent>;
  return typeof event.id === "string" && typeof event.timestamp === "string" &&
    (event.action === "login" || event.action === "password_change" || event.action === "master_setup") &&
    (event.actor === "admin" || event.actor === "master") &&
    (event.account === "admin" || event.account === "master") &&
    typeof event.success === "boolean" && typeof event.ip === "string" && typeof event.userAgent === "string";
}

export async function listAuthAuditEvents(limit = 100): Promise<{ events: AuthAuditEvent[]; total: number }> {
  if (!hasBlobConfiguration()) throw new Error("Penyimpanan audit belum tersedia.");
  const pathnames: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: AUDIT_PREFIX, limit: 1000, ...(cursor ? { cursor } : {}) });
    pathnames.push(...page.blobs.map((blob) => blob.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const selected = pathnames.sort((a, b) => b.localeCompare(a)).slice(0, Math.max(1, Math.min(limit, 200)));
  const events: AuthAuditEvent[] = [];
  for (let offset = 0; offset < selected.length; offset += 20) {
    const batch = await Promise.all(selected.slice(offset, offset + 20).map(async (pathname) => {
      const value = await readPrivateJson(pathname);
      return isAuthAuditEvent(value) ? value : null;
    }));
    events.push(...batch.filter((event): event is AuthAuditEvent => event !== null));
  }
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return { events, total: pathnames.length };
}

export function authError(status: number, message: string) {
  return jsonError(status, message);
}

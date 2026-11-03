import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to find a free port.");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test("serves the main page from the Next.js production build", async (t) => {
  const port = await unusedPort();
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { env: { ...process.env, PORT: String(port) }, stdio: "ignore" },
  );
  t.after(() => {
    if (server.exitCode === null) server.kill("SIGTERM");
  });

  const deadline = Date.now() + 30_000;
  let response;
  let lastError;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next.js server exited with code ${server.exitCode}.`);
    try {
      response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) break;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (!response?.ok) throw new Error(`Next.js server did not become ready: ${lastError ?? "timeout"}`);
  const html = await response.text();
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(html, /<title>Editor Surat Refund<\/title>/i);

  const base = `http://127.0.0.1:${port}`;
  await t.test("customer portal renders a shareable form without admin access", async () => {
    const portal = await fetch(base + "/portal");
    assert.equal(portal.status, 200);
    const portalHtml = await portal.text();
    assert.match(portalHtml, /Form Pengajuan Refund/);
    assert.match(portalHtml, /Nomor WhatsApp/);
    assert.match(portalHtml, /name=\"robots\"/);
  });
  await t.test("customer intake does not expose a list endpoint", async () => {
    const result = await fetch(base + "/api/customer-intake");
    assert.equal(result.status, 405);
  });
  await t.test("customer intake rejects an unconsented request", async () => {
    const result = await fetch(base + "/api/customer-intake", {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ name: "Test" }),
    });
    assert.equal(result.status, 400);
  });
  await t.test("customer intake requires a digital signature", async () => {
    const result = await fetch(base + "/api/customer-intake", {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ consent: true }),
    });
    assert.equal(result.status, 400);
    assert.match((await result.json()).error, /tanda tangan digital/i);
  });
  await t.test("customer intake rejects cross-origin submissions", async () => {
    const result = await fetch(base + "/api/customer-intake", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://untrusted.example" },
      body: JSON.stringify({}),
    });
    assert.equal(result.status, 403);
  });
  await t.test("customer intake honeypot discards automated submissions", async () => {
    const result = await fetch(base + "/api/customer-intake", {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ website: "automated-entry" }),
    });
    assert.equal(result.status, 201);
    assert.equal((await result.json()).ok, true);
  });
  for (const [path, method] of [
    ["/api/history", "GET"],
    ["/api/history", "POST"],
    ["/api/history/nonexistent", "GET"],
    ["/api/history/nonexistent", "DELETE"],
    ["/api/proof/proof_nonexistent.png", "GET"],
    ["/api/signature/signature_nonexistent.png", "GET"],
    ["/api/auth/session", "GET"],
    ["/api/auth/audit", "GET"],
    ["/api/auth/password", "POST"],
    ["/api/auth/accounts/master", "POST"],
  ]) {
    await t.test(`${method} ${path} denies unauthenticated access`, async () => {
      const result = await fetch(base + path, { method });
      assert.equal(result.status, 401);
      assert.match(result.headers.get("cache-control") ?? "", /no-store/);
    });
  }
  await t.test("wrong password is rejected without requiring storage access", async () => {
    const result = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ password: "__incorrect_smoke_test__" }),
    });
    assert.equal(result.status, 401);
  });
  await t.test("cross-origin login is rejected", async () => {
    const result = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://untrusted.example" },
      body: JSON.stringify({ password: "__incorrect_smoke_test__" }),
    });
    assert.equal(result.status, 403);
  });
});

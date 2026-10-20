import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import worker from "../src/index";
import { handleWebhook } from "../src/webhook";

const TARGET = "https://api2.cursor.sh/automations/webhook/abc123";
const CHANNEL_SECRET = "channel-secret";
const ENV: Env = { CHANNEL_SECRET };

function webhookUrl(params: Record<string, string> = { url: TARGET, token: "send-key" }): string {
  return `https://relay.example/webhook?${new URLSearchParams(params)}`;
}

async function sign(body: string, secret = CHANNEL_SECRET): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return btoa(String.fromCharCode(...mac));
}

async function post(
  body: string,
  { url = webhookUrl(), signature, env = ENV }: { url?: string; signature?: string | null; env?: Env } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const header = signature === undefined ? await sign(body) : signature;
  if (header !== null) headers["X-Line-Signature"] = header;
  const ctx = createExecutionContext();
  const response = await handleWebhook(new Request(url, { method: "POST", headers, body }), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

const BODY = JSON.stringify({
  destination: "Uxxxxxxxx",
  events: [{ type: "message", source: { type: "user", userId: "U1" }, message: { id: "1", type: "text", text: "こんにちは🙂" } }],
});

describe("/webhook", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("forwards the body unchanged to url with token as a Bearer header", async () => {
    expect((await post(BODY)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TARGET);
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer send-key",
      "X-Line-Signature": await sign(BODY),
    });
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe(BODY);
  });

  it("does not follow redirects and sets a timeout on the forward", async () => {
    await post(BODY);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns 200 to LINE and forwards only once when the upstream redirects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 307, headers: { Location: "https://evil.example/steal" } }),
    );
    expect((await post(BODY)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(TARGET);
    expect(error).toHaveBeenCalledWith("webhook: upstream redirected, not followed", { events: 1, status: 307 });
    error.mockRestore();
  });

  it("returns 400 and does not forward when url or token is missing or url is invalid", async () => {
    expect((await post(BODY, { url: webhookUrl({ url: TARGET }) })).status).toBe(400);
    expect((await post(BODY, { url: webhookUrl({ token: "k" }) })).status).toBe(400);
    expect((await post(BODY, { url: webhookUrl({ url: "not a url", token: "k" }) })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards to any https path on cursor.sh or its subdomains", async () => {
    for (const target of ["https://api3.cursor.sh/new/webhook/abc", "https://cursor.sh/hooks/abc"]) {
      expect((await post(BODY, { url: webhookUrl({ url: target, token: "k" }) })).status, target).toBe(200);
    }
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api3.cursor.sh/new/webhook/abc",
      "https://cursor.sh/hooks/abc",
    ]);
  });

  it("returns 403 and does not forward outside cursor.sh", async () => {
    for (const target of [
      "https://evil.example/automations/webhook/abc",
      "https://api2.cursor.sh.evil.example/automations/webhook/abc",
      "https://evilcursor.sh/automations/webhook/abc",
      "http://api2.cursor.sh/automations/webhook/abc",
      "https://api2.cursor.sh:8443/automations/webhook/abc",
      "https://user:pass@api2.cursor.sh/automations/webhook/abc",
    ]) {
      expect((await post(BODY, { url: webhookUrl({ url: target, token: "k" }) })).status, target).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 and does not forward when the LINE signature is missing or wrong", async () => {
    const tampered = BODY.replace("こんにちは", "さようなら");
    for (const signature of [null, "", "not base64!", await sign(BODY, "other-secret"), await sign(tampered)]) {
      expect((await post(BODY, { signature })).status, String(signature)).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 before checking the target when the LINE signature is wrong", async () => {
    for (const signature of [null, await sign(BODY, "other-secret")]) {
      expect((await post(BODY, { url: webhookUrl({ url: "https://evil.example/x", token: "k" }), signature })).status).toBe(401);
      expect((await post(BODY, { url: webhookUrl({}), signature })).status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 without reading the body when the LINE signature is missing or malformed", async () => {
    for (const signature of [undefined, "not base64!", btoa("short")]) {
      const headers: Record<string, string> = { "Content-Length": String(2 * 1024 * 1024) };
      if (signature !== undefined) headers["X-Line-Signature"] = signature;
      const request = new Request(webhookUrl(), { method: "POST", headers, body: BODY });
      expect((await handleWebhook(request, ENV, createExecutionContext())).status, String(signature)).toBe(401);
    }
  });

  it("returns 500 and does not forward when CHANNEL_SECRET is not set", async () => {
    for (const CHANNEL_SECRET of [undefined, "", " \n"]) {
      expect((await post(BODY, { env: { CHANNEL_SECRET } })).status, String(CHANNEL_SECRET)).toBe(500);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores surrounding whitespace in CHANNEL_SECRET", async () => {
    expect((await post(BODY, { env: { CHANNEL_SECRET: ` ${CHANNEL_SECRET}\n` } })).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a body signed by any of the configured channel secrets", async () => {
    const env: Env = { CHANNEL_SECRET, CHANNEL_SECRET_SHOP: "shop-secret", CHANNEL_SECRET_2: "second-secret" };
    for (const secret of [CHANNEL_SECRET, "shop-secret", "second-secret"]) {
      expect((await post(BODY, { env, signature: await sign(BODY, secret) })).status, secret).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("works with only CHANNEL_SECRET_<name> set", async () => {
    const env: Env = { CHANNEL_SECRET_SHOP: " shop-secret\n" };
    expect((await post(BODY, { env, signature: await sign(BODY, "shop-secret") })).status).toBe(200);
    expect((await post(BODY, { env })).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when no configured channel secret matches", async () => {
    const env: Env = { CHANNEL_SECRET, CHANNEL_SECRET_SHOP: "shop-secret" };
    expect((await post(BODY, { env, signature: await sign(BODY, "other-secret") })).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores blank secrets and variables that are not channel secrets", async () => {
    const env = { CHANNEL_SECRET: " ", CHANNEL_SECRET_SHOP: "", CHANNEL_SECRETX: CHANNEL_SECRET, OTHER: CHANNEL_SECRET, CHANNEL_SECRET_KV: {} };
    expect((await post(BODY, { env })).status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 200 without forwarding when there are no events", async () => {
    expect((await post(JSON.stringify({ destination: "U", events: [] }))).status).toBe(200);
    expect((await post(JSON.stringify({ destination: "U" }))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON or an empty body", async () => {
    expect((await post("{oops")).status).toBe(400);
    const request = new Request(webhookUrl(), { method: "POST", headers: { "X-Line-Signature": await sign("") } });
    expect((await handleWebhook(request, ENV, createExecutionContext())).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 200 to LINE even when the upstream fails", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 401 }));
    expect((await post(BODY)).status).toBe(200);
  });

  it("returns 200 to LINE even when the upstream is unreachable", async () => {
    for (const thrown of [new TypeError("network error"), "not an Error"]) {
      fetchMock.mockImplementation(async () => {
        throw thrown;
      });
      expect((await post(BODY)).status).toBe(200);
    }
  });

  it("returns 413 for a body over the limit", async () => {
    const ctx = createExecutionContext();
    const request = new Request(webhookUrl(), {
      method: "POST",
      headers: { "Content-Length": String(2 * 1024 * 1024), "X-Line-Signature": await sign(BODY) },
      body: BODY,
    });
    expect((await handleWebhook(request, ENV, ctx)).status).toBe(413);
  });

  it("returns 413 for a streamed body over the limit without Content-Length", async () => {
    const chunk = new Uint8Array(256 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 5) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const request = new Request(webhookUrl(), { method: "POST", headers: { "X-Line-Signature": await sign(BODY) }, body: stream });
    expect(request.headers.get("Content-Length")).toBeNull();
    expect((await handleWebhook(request, ENV, createExecutionContext())).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails the request when the body stream breaks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection lost"));
      },
    });
    const request = new Request(webhookUrl(), { method: "POST", headers: { "X-Line-Signature": await sign(BODY) }, body: stream });
    await expect(handleWebhook(request, ENV, createExecutionContext())).rejects.toThrow("connection lost");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 200 on /, 405 for non-POST and 404 for unknown paths", async () => {
    const call = (url: string) =>
      worker.fetch(new Request(url) as Request<unknown, IncomingRequestCfProperties>, {}, createExecutionContext());
    expect((await call("https://relay.example/")).status).toBe(200);
    expect((await call(webhookUrl())).status).toBe(405);
    expect((await call("https://relay.example/x")).status).toBe(404);
  });
});

import { BodyTooLargeError, readLimitedBody } from "./body";
import { type Env, type ForwardTarget, targetFromQuery } from "./env";
import { decodeLineSignature, lineSignatureMatches } from "./signature";

export const WEBHOOK_BODY_LIMIT = 1024 * 1024;
export const FORWARD_TIMEOUT_MS = 10_000;

async function forward(target: ForwardTarget, body: Uint8Array, signature: string, events: number): Promise<void> {
  const headers = { ...target.headers, "X-Line-Signature": signature };
  try {
    const response = await fetch(target.url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    if (response.ok) console.log("webhook: forwarded", { events, status: response.status });
    else if (response.status >= 300 && response.status < 400)
      console.error("webhook: upstream redirected, not followed", { events, status: response.status });
    else console.error("webhook: upstream returned an error", { events, status: response.status });
  } catch (error) {
    console.error("webhook: forward failed", { events, error: (error as Error)?.name ?? "unknown" });
  }
}

export async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const channelSecret = env.CHANNEL_SECRET?.trim();
  if (!channelSecret) {
    console.error("webhook: CHANNEL_SECRET is not set");
    return new Response(null, { status: 500 });
  }
  const signature = request.headers.get("X-Line-Signature") ?? "";
  const given = decodeLineSignature(signature);
  if (given === null) {
    console.warn("webhook: invalid LINE signature");
    return new Response(null, { status: 401 });
  }

  let body: Uint8Array;
  try {
    body = await readLimitedBody(request, WEBHOOK_BODY_LIMIT);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      console.warn("webhook: body too large");
      return new Response(null, { status: 413 });
    }
    throw error;
  }

  if (!(await lineSignatureMatches(body, given, channelSecret))) {
    console.warn("webhook: invalid LINE signature");
    return new Response(null, { status: 401 });
  }
  const result = targetFromQuery(new URL(request.url));
  if (!result.ok) {
    console.warn("webhook: invalid target", { status: result.status });
    return new Response(null, { status: result.status });
  }

  let events: unknown[];
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as { events?: unknown };
    events = Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    console.warn("webhook: invalid JSON");
    return new Response(null, { status: 400 });
  }

  if (events.length > 0) ctx.waitUntil(forward(result.target, body, signature, events.length));
  return new Response(null, { status: 200 });
}

export interface Env {
  CHANNEL_SECRET?: string;
  [name: `CHANNEL_SECRET_${string}`]: unknown;
}

export function channelSecrets(env: Env): string[] {
  return Object.entries(env).flatMap(([name, value]) => {
    if (name !== "CHANNEL_SECRET" && !name.startsWith("CHANNEL_SECRET_")) return [];
    const secret = typeof value === "string" ? value.trim() : "";
    return secret === "" ? [] : [secret];
  });
}

export interface ForwardTarget {
  url: string;
  headers: Record<string, string>;
}

export type TargetResult = { ok: true; target: ForwardTarget } | { ok: false; status: 400 | 403 };

export function targetFromQuery(requestUrl: URL): TargetResult {
  const raw = requestUrl.searchParams.get("url");
  const token = requestUrl.searchParams.get("token");
  if (!raw || !token) return { ok: false, status: 400 };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, status: 400 };
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") {
    return { ok: false, status: 403 };
  }
  return {
    ok: true,
    target: {
      url: url.toString(),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    },
  };
}

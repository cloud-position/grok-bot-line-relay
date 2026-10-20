const SIGNATURE_BYTES = 32;

export function decodeLineSignature(header: string): Uint8Array | null {
  try {
    const bytes = Uint8Array.from(atob(header), (char) => char.charCodeAt(0));
    return bytes.byteLength === SIGNATURE_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

export async function lineSignatureMatches(body: Uint8Array, signature: Uint8Array, channelSecret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signature, body);
}

export async function lineSignatureMatchesAny(body: Uint8Array, signature: Uint8Array, channelSecrets: string[]): Promise<boolean> {
  for (const secret of channelSecrets) {
    if (await lineSignatureMatches(body, signature, secret)) return true;
  }
  return false;
}

/**
 * Signs chat-history requests so the endpoint is not open to the anonymous
 * internet.
 *
 * The key ships inside this bundle. It attests the application, not the
 * person: anyone who reads the bundle can sign a request for any email.
 * Per-member isolation requires a real session and is tracked separately.
 */
const APP_KEY: string = import.meta.env.VITE_CHAT_HISTORY_APP_KEY ?? "";

let keyPromise: Promise<CryptoKey> | null = null;

const getKey = () => {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(APP_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
  return keyPromise;
};

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** Returns the `x-lawgpt-sig` header value, or null when no key is configured. */
export const signHistoryRequest = async (
  action: string,
  email: string,
): Promise<string | null> => {
  if (!APP_KEY) return null;
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const payload = `v1.${ts}.${nonce}.${action}.${email.toLowerCase()}`;
  const mac = toHex(
    await crypto.subtle.sign("HMAC", await getKey(), new TextEncoder().encode(payload)),
  );
  return `v1.${ts}.${nonce}.${mac}`;
};

/**
 * ID generation that works everywhere the app runs: Node, secure browser
 * contexts, and *insecure* LAN contexts (http://192.168.x.x) where
 * crypto.randomUUID is unavailable but crypto.getRandomValues still works.
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function randomString(length = 16): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export function createId(prefix?: string): string {
  const id = randomString(16);
  return prefix ? `${prefix}_${id}` : id;
}

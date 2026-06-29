'use client';

/* ============================================================
 * End-to-End Encryption using Web Crypto API
 * Key Exchange: ECDH (P-256)
 * Encryption: AES-GCM 256-bit
 * Signing: ECDSA (P-256)
 * ============================================================ */

/* ── Helpers ── */
const buf2b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const b64toBuf = (b64: string): ArrayBuffer => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
};

/* ── ECDH Key Exchange ── */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const buf = await crypto.subtle.exportKey('spki', key);
  return buf2b64(buf);
}

export async function importPublicKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    b64toBuf(b64),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

export async function exportPrivateKey(key: CryptoKey): Promise<string> {
  const buf = await crypto.subtle.exportKey('pkcs8', key);
  return buf2b64(buf);
}

export async function importPrivateKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    b64toBuf(b64),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
}

export async function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/* ── AES-GCM Encryption ── */
export async function encryptMessage(
  sharedSecret: CryptoKey,
  plaintext: string
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedSecret,
    encoded
  );
  return { ciphertext: buf2b64(cipherBuf), iv: buf2b64(iv) };
}

export async function decryptMessage(
  sharedSecret: CryptoKey,
  ciphertext: string,
  iv: string
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64toBuf(iv) },
    sharedSecret,
    b64toBuf(ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}

export async function encryptFile(
  sharedSecret: CryptoKey,
  data: ArrayBuffer
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedSecret, data);
  return { ciphertext: buf2b64(cipherBuf), iv: buf2b64(iv) };
}

export async function decryptFile(
  sharedSecret: CryptoKey,
  ciphertext: string,
  iv: string
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64toBuf(iv) },
    sharedSecret,
    b64toBuf(ciphertext)
  );
}

/* ── ECDSA Signing ── */
export async function generateSigningKeys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
}

export async function exportSigningPublicKey(key: CryptoKey): Promise<string> {
  const buf = await crypto.subtle.exportKey('spki', key);
  return buf2b64(buf);
}

export async function exportSigningPrivateKey(key: CryptoKey): Promise<string> {
  const buf = await crypto.subtle.exportKey('pkcs8', key);
  return buf2b64(buf);
}

export async function importSigningPublicKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    b64toBuf(b64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
}

export async function importSigningPrivateKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    b64toBuf(b64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  );
}

export async function signData(privateKey: CryptoKey, data: ArrayBuffer): Promise<string> {
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data);
  return buf2b64(sig);
}

export async function verifySignature(
  publicKey: CryptoKey,
  signature: string,
  data: ArrayBuffer
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      b64toBuf(signature),
      data
    );
  } catch {
    return false;
  }
}

/* ── Key persistence helpers ── */
export async function persistKeyPair(
  keyPair: CryptoKeyPair,
  signingKeyPair: CryptoKeyPair,
  storeKeyFn: (id: string, data: string) => Promise<void>
): Promise<{ publicKeyRaw: string; signingPublicKeyRaw: string }> {
  const [privB64, pubB64, sigPrivB64, sigPubB64] = await Promise.all([
    exportPrivateKey(keyPair.privateKey),
    exportPublicKey(keyPair.publicKey),
    exportSigningPrivateKey(signingKeyPair.privateKey),
    exportSigningPublicKey(signingKeyPair.publicKey),
  ]);
  await Promise.all([
    storeKeyFn('ecdh_private', privB64),
    storeKeyFn('ecdh_public', pubB64),
    storeKeyFn('ecdsa_private', sigPrivB64),
    storeKeyFn('ecdsa_public', sigPubB64),
  ]);
  return { publicKeyRaw: pubB64, signingPublicKeyRaw: sigPubB64 };
}

export async function loadKeyPair(
  retrieveKeyFn: (id: string) => Promise<string | undefined>
): Promise<{ keyPair: CryptoKeyPair; signingKeyPair: CryptoKeyPair } | null> {
  const [privB64, pubB64, sigPrivB64, sigPubB64] = await Promise.all([
    retrieveKeyFn('ecdh_private'),
    retrieveKeyFn('ecdh_public'),
    retrieveKeyFn('ecdsa_private'),
    retrieveKeyFn('ecdsa_public'),
  ]);
  if (!privB64 || !pubB64 || !sigPrivB64 || !sigPubB64) return null;
  const [privKey, pubKey, sigPrivKey, sigPubKey] = await Promise.all([
    importPrivateKey(privB64),
    importPublicKey(pubB64),
    importSigningPrivateKey(sigPrivB64),
    importSigningPublicKey(sigPubB64),
  ]);
  return {
    keyPair: { privateKey: privKey, publicKey: pubKey },
    signingKeyPair: { privateKey: sigPrivKey, publicKey: sigPubKey },
  };
}

/* ── Shared secret cache ── */
const sharedSecretCache = new Map<string, CryptoKey>();

export async function getOrDeriveSharedSecret(
  myPrivateKey: CryptoKey,
  theirPublicKeyB64: string
): Promise<CryptoKey> {
  if (sharedSecretCache.has(theirPublicKeyB64)) {
    return sharedSecretCache.get(theirPublicKeyB64)!;
  }
  const theirPublicKey = await importPublicKey(theirPublicKeyB64);
  const secret = await deriveSharedSecret(myPrivateKey, theirPublicKey);
  sharedSecretCache.set(theirPublicKeyB64, secret);
  return secret;
}

export function clearSharedSecretCache(): void {
  sharedSecretCache.clear();
}

/**
 * E2EE Crypto Utilities
 *
 * Implements End-to-End Encryption using the Web Crypto API (SubtleCrypto).
 *
 * ENCRYPTION FLOW:
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Each user generates an ECDH P-256 key pair on login
 *    - Public key  → exported to JWK, sent to server (for others to find)
 *    - Private key → stays in memory, NEVER sent to server
 *
 * 2. To encrypt a message for a room:
 *    - Derive a shared secret using ECDH (our private key + recipient's public key)
 *    - Derive an AES-GCM key from the shared secret via HKDF
 *    - Generate a random 96-bit IV (unique per message — guarantees IND-CCA2)
 *    - Encrypt the message with AES-GCM-256
 *    - Send: { encryptedContent (base64), iv (base64) }
 *
 * 3. To decrypt:
 *    - Re-derive the same shared secret (ECDH is commutative)
 *    - Re-derive the AES key via HKDF
 *    - Decrypt with the stored IV
 *
 * SECURITY PROPERTIES:
 * - Perfect Forward Secrecy: ephemeral keys can be generated per session
 * - IND-CCA2: AES-GCM with random IV per message
 * - Zero-knowledge server: server only sees ciphertext + metadata
 * ─────────────────────────────────────────────────────────────────────────
 */

const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };
const AES_PARAMS = { name: 'AES-GCM', length: 256 };
const HKDF_PARAMS = (salt) => ({ name: 'HKDF', hash: 'SHA-256', salt, info: new Uint8Array() });

// ── Key Generation ──────────────────────────────────────────────────────────

/**
 * Generate an ECDH P-256 key pair.
 * Returns { publicKey: CryptoKey, privateKey: CryptoKey }
 */
export async function generateKeyPair() {
  return crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveKey', 'deriveBits']);
}

/**
 * Export a CryptoKey public key to JWK (JSON Web Key) string for server storage.
 */
export async function exportPublicKey(publicKey) {
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  return JSON.stringify(jwk);
}

/**
 * Import a JWK public key string back into a CryptoKey.
 */
export async function importPublicKey(jwkString) {
  const jwk = JSON.parse(jwkString);
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    ECDH_PARAMS,
    true,
    [] // Public keys don't need key usages for ECDH — only the private key does
  );
}

// ── Shared Secret Derivation ────────────────────────────────────────────────

/**
 * Derive a shared AES-GCM key from ECDH private key + counterpart's public key.
 *
 * This is the core of E2EE:
 * - Alice uses (Alice.privateKey, Bob.publicKey) → sharedSecret
 * - Bob uses   (Bob.privateKey, Alice.publicKey) → same sharedSecret
 * - Server has neither private key so cannot derive the shared secret
 */
export async function deriveSharedKey(myPrivateKey, theirPublicKey) {
  // Step 1: Derive raw bits using ECDH
  const rawBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPublicKey },
    myPrivateKey,
    256
  );

  // Step 2: Import raw bits as HKDF source key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    rawBits,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );

  // Step 3: Use HKDF to derive a proper AES-GCM key
  // Salt adds domain separation and prevents cross-protocol attacks
  const salt = new TextEncoder().encode('chat-e2ee-v1');

  return crypto.subtle.deriveKey(
    HKDF_PARAMS(salt),
    keyMaterial,
    AES_PARAMS,
    false,
    ['encrypt', 'decrypt']
  );
}

// ── Message Encryption / Decryption ────────────────────────────────────────

/**
 * Encrypt a plaintext string with AES-GCM-256.
 *
 * Each call generates a fresh random IV — this is CRITICAL for AES-GCM security.
 * Reusing an IV with the same key breaks AES-GCM's confidentiality guarantees.
 *
 * Returns { encryptedContent: string (base64), iv: string (base64) }
 */
export async function encryptMessage(sharedKey, plaintext) {
  // Generate cryptographically random 96-bit IV (recommended for AES-GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    encoded
  );

  return {
    encryptedContent: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv),
  };
}

/**
 * Decrypt an AES-GCM-encrypted message.
 * Returns plaintext string, or throws on decryption failure.
 */
export async function decryptMessage(sharedKey, encryptedContent, ivBase64) {
  const iv = base64ToArrayBuffer(ivBase64);
  const ciphertext = base64ToArrayBuffer(encryptedContent);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    sharedKey,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

// ── Key Cache ───────────────────────────────────────────────────────────────

/**
 * A simple in-memory cache for derived shared keys.
 * Key: `${myKeyVersion}-${theirUserId}-${theirKeyVersion}`
 * Value: CryptoKey
 *
 * This avoids re-deriving the shared key for every message.
 * Cache is invalidated when key versions change (key rotation).
 */
const sharedKeyCache = new Map();

export function getCachedSharedKey(cacheKey) {
  return sharedKeyCache.get(cacheKey);
}

export function setCachedSharedKey(cacheKey, key) {
  // Limit cache size to prevent memory leaks in large rooms
  if (sharedKeyCache.size > 100) {
    const firstKey = sharedKeyCache.keys().next().value;
    sharedKeyCache.delete(firstKey);
  }
  sharedKeyCache.set(cacheKey, key);
}

export function clearKeyCache() {
  sharedKeyCache.clear();
}

// ── Utilities ───────────────────────────────────────────────────────────────

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

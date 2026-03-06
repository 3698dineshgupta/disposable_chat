// ECDH + AES-GCM Key Exchange for Disposable Rooms

export async function generateKeyPair() {
    return crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
    );
}

export async function exportPublicKey(publicKey) {
    const raw = await crypto.subtle.exportKey('raw', publicKey);
    return arrayBufferToBase64(raw);
}

export async function importPublicKey(base64Key) {
    const raw = base64ToArrayBuffer(base64Key);
    return crypto.subtle.importKey(
        'raw',
        raw,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
    );
}

export async function deriveSharedSecret(privateKey, publicKey) {
    return crypto.subtle.deriveKey(
        { name: 'ECDH', public: publicKey },
        privateKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// Utilities
export function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

/**
 * Digital Signature utility using ECDSA (Web Crypto API)
 * Curve: P-256
 */

import { arrayBufferToBase64, base64ToArrayBuffer } from './keyExchange';

/**
 * Generates an ECDSA key pair for signing and verification
 */
export async function generateSigningKeys() {
    return await window.crypto.subtle.generateKey(
        {
            name: "ECDSA",
            namedCurve: "P-256"
        },
        true,
        ["sign", "verify"]
    );
}

/**
 * Signs the given data (encrypted message bytes) using the private key
 * @param {CryptoKey} privateKey 
 * @param {ArrayBuffer} data 
 * @returns {Promise<string>} Base64 encoded signature
 */
export async function signMessage(privateKey, data) {
    const signature = await window.crypto.subtle.sign(
        {
            name: "ECDSA",
            hash: { name: "SHA-256" },
        },
        privateKey,
        data
    );
    return arrayBufferToBase64(signature);
}

/**
 * Verifies the signature of the data using the public key
 * @param {CryptoKey} publicKey 
 * @param {string} signatureBase64 
 * @param {ArrayBuffer} data 
 * @returns {Promise<boolean>}
 */
export async function verifySignature(publicKey, signatureBase64, data) {
    try {
        const signature = base64ToArrayBuffer(signatureBase64);
        return await window.crypto.subtle.verify(
            {
                name: "ECDSA",
                hash: { name: "SHA-256" },
            },
            publicKey,
            signature,
            data
        );
    } catch (err) {
        console.error("Signature verification internal error", err);
        return false;
    }
}

/**
 * Exports a public key to a base64 string
 */
export async function exportSigningPublicKey(publicKey) {
    const raw = await window.crypto.subtle.exportKey("raw", publicKey);
    return arrayBufferToBase64(raw);
}

/**
 * Imports a public key from a base64 string
 */
export async function importSigningPublicKey(base64Key) {
    const raw = base64ToArrayBuffer(base64Key);
    return await window.crypto.subtle.importKey(
        "raw",
        raw,
        {
            name: "ECDSA",
            namedCurve: "P-256"
        },
        true,
        ["verify"]
    );
}

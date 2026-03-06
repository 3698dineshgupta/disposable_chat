export async function encryptMessage(key, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoded
    );

    return {
        ciphertext: arrayBufferToBase64(ciphertext),
        iv: arrayBufferToBase64(iv)
    };
}

export async function decryptMessage(key, ciphertextBase64, ivBase64) {
    try {
        const cipherBytes = base64ToArrayBuffer(ciphertextBase64);
        const ivBytes = base64ToArrayBuffer(ivBase64);

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: ivBytes },
            key,
            cipherBytes
        );

        return new TextDecoder().decode(decrypted);
    } catch (error) {
        console.error("Decryption failed", error);
        return null;
    }
}

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

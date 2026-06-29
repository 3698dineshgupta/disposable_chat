'use client';

import {
  generateKeyPair, generateSigningKeys,
  exportPublicKey, exportSigningPublicKey,
  loadKeyPair, persistKeyPair,
} from '@/lib/crypto/index';
import { storeKey, retrieveKey } from '@/lib/db/index';
import { authApi } from '@/lib/api';

export async function ensureKeysUploaded(existingPublicKey?: string | null): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const loaded = await loadKeyPair(retrieveKey);

    if (!loaded) {
      const keyPair        = await generateKeyPair();
      const signingKeyPair = await generateSigningKeys();
      const { publicKeyRaw, signingPublicKeyRaw } = await persistKeyPair(keyPair, signingKeyPair, storeKey);
      await authApi.updateKeys(publicKeyRaw, signingPublicKeyRaw);
      return;
    }

    if (!existingPublicKey) {
      const keyPair        = await generateKeyPair();
      const signingKeyPair = await generateSigningKeys();
      const { publicKeyRaw, signingPublicKeyRaw } = await persistKeyPair(keyPair, signingKeyPair, storeKey);
      await authApi.updateKeys(publicKeyRaw, signingPublicKeyRaw);
    }
  } catch (err) {
    console.error('[setupKeys] Failed to ensure keys:', err);
  }
}

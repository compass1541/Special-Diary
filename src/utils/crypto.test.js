import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { encryptString, decryptString, looksEncrypted } from './crypto.js';

beforeAll(() => {
    // Node 20 vitest 환경에서 globalThis.crypto.subtle 보장
    if (!globalThis.crypto?.subtle) {
        // @ts-ignore
        globalThis.crypto = webcrypto;
    }
});

describe('encrypt/decrypt round-trip', () => {
    it('round-trips ASCII', async () => {
        const ct = await encryptString('hello world', 'correct horse battery staple');
        expect(looksEncrypted(ct)).toBe(true);
        const pt = await decryptString(ct, 'correct horse battery staple');
        expect(pt).toBe('hello world');
    });

    it('round-trips Korean + emoji', async () => {
        const original = '오늘은 정말 좋은 날이었다 ✨ 친구를 만나서 기뻤다.';
        const ct = await encryptString(original, '비밀번호123!');
        const pt = await decryptString(ct, '비밀번호123!');
        expect(pt).toBe(original);
    });

    it('produces different ciphertext for same input (random salt+iv)', async () => {
        const a = await encryptString('same input', 'same passphrase');
        const b = await encryptString('same input', 'same passphrase');
        expect(a).not.toBe(b);
    });

    it('rejects wrong passphrase', async () => {
        const ct = await encryptString('secret', 'right pass');
        await expect(decryptString(ct, 'wrong pass')).rejects.toBeTruthy();
    });

    it('rejects tampered ciphertext (AEAD integrity)', async () => {
        const ct = await encryptString('secret', 'pass');
        // Flip the last base64 char
        const tampered = ct.slice(0, -1) + (ct.endsWith('A') ? 'B' : 'A');
        await expect(decryptString(tampered, 'pass')).rejects.toBeTruthy();
    });

    it('rejects unsupported version prefix', async () => {
        await expect(decryptString('v999:abc', 'pass')).rejects.toThrow(/version/i);
    });
});

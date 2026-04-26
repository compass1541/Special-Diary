/**
 * 클라이언트 측 종단간 암호화 유틸 (M7).
 *
 * AES-GCM (256bit) + PBKDF2 (SHA-256, 200k iterations).
 * WebCrypto만 사용 — 외부 의존성 없음.
 *
 * 출력 포맷 (string):
 *   "v1:" + base64(salt|iv|ciphertext)
 *      salt: 16 bytes (per-entry; 매번 무작위)
 *      iv:   12 bytes (AES-GCM 표준)
 *      ciphertext: variable
 *
 * 호출자 책임:
 *   - passphrase 자체는 어디에도 저장하지 말 것 (sessionStorage도 권장하지 않음).
 *   - passphrase를 잊으면 데이터 복구 불가 — UI에서 명시적으로 경고.
 */

const PBKDF2_ITERATIONS = 200_000;
const SALT_LEN = 16;
const IV_LEN = 12;
const VERSION = 'v1';

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}
function fromBase64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

async function deriveKey(passphrase, salt) {
    const baseKey = await crypto.subtle.importKey(
        'raw',
        enc.encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptString(plaintext, passphrase) {
    if (typeof plaintext !== 'string') throw new TypeError('plaintext must be string');
    if (!passphrase) throw new Error('passphrase is required');
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const key = await deriveKey(passphrase, salt);
    const ct = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(plaintext)
    ));
    const blob = new Uint8Array(salt.length + iv.length + ct.length);
    blob.set(salt, 0);
    blob.set(iv, salt.length);
    blob.set(ct, salt.length + iv.length);
    return `${VERSION}:${toBase64(blob)}`;
}

export async function decryptString(payload, passphrase) {
    if (typeof payload !== 'string') throw new TypeError('payload must be string');
    if (!payload.startsWith(`${VERSION}:`)) throw new Error('Unsupported ciphertext version');
    const blob = fromBase64(payload.slice(VERSION.length + 1));
    if (blob.length < SALT_LEN + IV_LEN + 1) throw new Error('Ciphertext too short');
    const salt = blob.slice(0, SALT_LEN);
    const iv = blob.slice(SALT_LEN, SALT_LEN + IV_LEN);
    const ct = blob.slice(SALT_LEN + IV_LEN);
    const key = await deriveKey(passphrase, salt);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return dec.decode(pt);
}

/** payload가 이 모듈로 암호화된 형태로 보이는지 빠른 감지 (저장 시 이중 암호화 방지). */
export function looksEncrypted(payload) {
    return typeof payload === 'string' && payload.startsWith(`${VERSION}:`);
}

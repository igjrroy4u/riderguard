// AES-GCM 256-bit client-side encryption for sensitive Aadhaar data using Web Crypto API

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(passphrase: string, uid: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${passphrase}:${uid}:riderguard-vault-v1`),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 120000,
      hash: 'SHA-256',
    },
    baseMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function normalizeAadhaar(input: string): string {
  return input.replace(/\D/g, '').slice(0, 12);
}

export function maskAadhaar(digits: string): string {
  const clean = normalizeAadhaar(digits);
  if (clean.length !== 12) return '';
  return `XXXX-XXXX-${clean.slice(8)}`;
}

export async function encryptAadhaar(
  rawAadhaar: string,
  pin: string,
  uid: string
): Promise<{ masked: string; ciphertext: string; iv: string; salt: string }> {
  const clean = normalizeAadhaar(rawAadhaar);
  if (clean.length !== 12) {
    throw new Error('Aadhaar number must contain exactly 12 digits.');
  }
  if (pin.trim().length < 4) {
    throw new Error('Vault PIN must be at least 4 characters to encrypt Aadhaar.');
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(pin.trim(), uid, salt);
  const encoded = new TextEncoder().encode(clean);
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    encoded
  );

  return {
    masked: maskAadhaar(clean),
    ciphertext: toBase64(new Uint8Array(encryptedBuffer)),
    iv: toBase64(iv),
    salt: toBase64(salt),
  };
}

export async function decryptAadhaar(
  ciphertext: string,
  ivB64: string,
  saltB64: string,
  pin: string,
  uid: string
): Promise<string> {
  if (!ciphertext || !ivB64 || !saltB64) {
    throw new Error('No encrypted Aadhaar payload is stored.');
  }
  const salt = fromBase64(saltB64);
  const iv = fromBase64(ivB64);
  const cipherBytes = fromBase64(ciphertext);
  const key = await deriveAesKey(pin.trim(), uid, salt);

  try {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      cipherBytes.buffer as ArrayBuffer
    );
    const digits = new TextDecoder().decode(plainBuffer);
    return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}`;
  } catch {
    throw new Error('Incorrect Vault PIN. Unable to decrypt Aadhaar record.');
  }
}

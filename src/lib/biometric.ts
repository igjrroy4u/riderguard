// Real WebAuthn Platform Authenticator (Fingerprint / Touch ID / Face ID / Windows Hello)

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export async function checkBiometricSupport(): Promise<{
  supported: boolean;
  reason: string;
}> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return {
      supported: false,
      reason: 'WebAuthn biometric API is not supported in this browser.',
    };
  }
  if (!window.isSecureContext) {
    return {
      supported: false,
      reason: 'Biometric authentication requires a secure HTTPS context.',
    };
  }
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      return {
        supported: false,
        reason: 'No built-in fingerprint or platform biometric authenticator detected on this device.',
      };
    }
    return {
      supported: true,
      reason: 'Platform biometric authenticator (Fingerprint / Touch ID / Windows Hello) is available.',
    };
  } catch {
    return {
      supported: false,
      reason: 'Unable to query platform biometric hardware status.',
    };
  }
}

export async function enrollBiometricCredential(params: {
  uid: string;
  email: string;
  fullName: string;
}): Promise<string> {
  const support = await checkBiometricSupport();
  if (!support.supported) {
    throw new Error(support.reason);
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userIdBytes = new TextEncoder().encode(params.uid);

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: 'RiderGuard Safety System',
      },
      user: {
        id: userIdBytes,
        name: params.email || params.uid,
        displayName: params.fullName || 'Rider',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Biometric registration was cancelled.');
  }

  return bufferToBase64Url(credential.rawId);
}

export async function verifyBiometricCredential(credentialId: string): Promise<boolean> {
  const support = await checkBiometricSupport();
  if (!support.supported) {
    throw new Error(support.reason);
  }
  if (!credentialId) {
    throw new Error('No biometric passkey enrolled for this account.');
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rawId = base64UrlToUint8Array(credentialId);

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [
        {
          id: rawId.buffer as ArrayBuffer,
          type: 'public-key',
          transports: ['internal'],
        },
      ],
      userVerification: 'required',
      timeout: 60000,
    },
  });

  return Boolean(assertion);
}

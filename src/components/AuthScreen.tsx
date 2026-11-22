import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldAlert,
  User,
  UserPlus,
} from 'lucide-react';
import firebaseConfig from '../../firebase-applet-config.json';
import { auth, googleProvider } from '../lib/firebase';
import { AUTH_HERO_URL } from '../types';

type AuthMode = 'signin' | 'register' | 'reset';

interface AuthErrorState {
  code?: string;
  message: string;
}

export const AuthScreen: React.FC = () => {
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [mode, setMode] = useState<AuthMode>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthErrorState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [heroLoaded, setHeroLoaded] = useState(true);
  const [copiedDomain, setCopiedDomain] = useState(false);

  const projectId = firebaseConfig.projectId || '';
  const firebaseProvidersUrl = projectId
    ? `https://console.firebase.google.com/project/${projectId}/authentication/providers`
    : 'https://console.firebase.google.com/';
  const firebaseDomainsUrl = projectId
    ? `https://console.firebase.google.com/project/${projectId}/authentication/settings`
    : 'https://console.firebase.google.com/';
  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';

  const handleCopyDomain = async () => {
    if (!currentHost) return;
    try {
      await navigator.clipboard.writeText(currentHost);
      setCopiedDomain(true);
      window.setTimeout(() => setCopiedDomain(false), 2000);
    } catch {
      setCopiedDomain(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Always prompt the Google account chooser so riders can register or sign in with ANY Google / Gmail email
      googleProvider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, googleProvider);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError({
          code,
          message:
            'Google sign-in window was closed before finishing. Click the button again and choose any email account.',
        });
      } else if (code === 'auth/popup-blocked') {
        setError({
          code,
          message:
            'Your browser blocked the Google sign-in popup. Allow popups for this site and tap "Continue with Google" again.',
        });
      } else if (code === 'auth/unauthorized-domain') {
        setError({
          code,
          message: `This domain (${currentHost}) is not yet listed under Firebase Authorized Domains.`,
        });
      } else if (code === 'auth/network-request-failed') {
        setError({
          code,
          message: 'Network error while contacting Google Sign-In. Check your internet connection and try again.',
        });
      } else {
        setError({
          code,
          message: err instanceof Error ? err.message : 'Unable to sign in with Google.',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError({ message: 'Please enter a valid email address.' });
      return;
    }

    setBusy(true);
    try {
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, trimmedEmail);
        setNotice(
          `Password reset link sent to ${trimmedEmail}. Check your inbox (and spam folder) to set a new password.`
        );
        setMode('signin');
      } else if (mode === 'register') {
        if (fullName.trim().length < 2) {
          setError({ message: 'Please enter your full name (at least 2 characters).' });
          setBusy(false);
          return;
        }
        if (password.length < 8) {
          setError({ message: 'Password must be at least 8 characters long.' });
          setBusy(false);
          return;
        }
        if (password !== confirmPassword) {
          setError({ message: 'Passwords do not match. Please re-enter both password fields.' });
          setBusy(false);
          return;
        }
        const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
        await updateProfile(cred.user, { displayName: fullName.trim() });
        await sendEmailVerification(cred.user).catch(() => undefined);
        await cred.user.reload().catch(() => undefined);
        setNotice(
          'Account created! Please check your email inbox and click the verification link to unlock cloud saves.'
        );
      } else {
        if (!password) {
          setError({ message: 'Please enter your password.' });
          setBusy(false);
          return;
        }
        await signInWithEmailAndPassword(auth, trimmedEmail, password);
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setError({
          code,
          message:
            'Firebase still has the Email/Password toggle turned OFF for this project. Either turn it ON in Firebase Console below, or click "Sign In / Register with Any Google Account" above (works immediately with any Gmail).',
        });
      } else if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        setError({
          code,
          message:
            'Invalid email or password. If you signed up with Google before, click "Sign In / Register with Google" above.',
        });
      } else if (code === 'auth/email-already-in-use') {
        setError({
          code,
          message: 'An account with this email already exists. Switch to Sign In or reset your password.',
        });
      } else if (code === 'auth/weak-password') {
        setError({
          code,
          message: 'Please choose a stronger password (at least 8 characters).',
        });
      } else if (code === 'auth/invalid-email') {
        setError({
          code,
          message: 'That email address format looks invalid. Please check for typos.',
        });
      } else if (code === 'auth/too-many-requests') {
        setError({
          code,
          message: 'Too many failed attempts. Wait a minute or use "Forgot Password" to reset access.',
        });
      } else if (code === 'auth/unauthorized-domain') {
        setError({
          code,
          message: `This domain (${currentHost}) is not yet authorized in Firebase Authentication.`,
        });
      } else if (code === 'auth/network-request-failed') {
        setError({
          code,
          message: 'Network error while reaching Firebase Authentication. Check your internet connection.',
        });
      } else {
        setError({
          code,
          message: err instanceof Error ? err.message : 'Authentication failed.',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 grid grid-cols-1 lg:grid-cols-12 items-stretch">
      {/* Left Editorial Media Column */}
      <div className="relative lg:col-span-7 bg-slate-900 overflow-hidden flex flex-col justify-between p-8 lg:p-12 min-h-[260px]">
        {heroLoaded && (
          <img
            src={AUTH_HERO_URL}
            alt="Motorcyclist riding along a coastal highway at dawn"
            referrerPolicy="no-referrer"
            onError={() => setHeroLoaded(false)}
            className="absolute inset-0 w-full h-full object-cover object-center"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/55 to-slate-950/40" />

        <div className="relative z-10 flex items-center gap-2.5 text-white">
          <ShieldAlert className="w-6 h-6 text-red-500 shrink-0" />
          <span className="font-display text-lg font-bold tracking-tight whitespace-nowrap">
            RiderGuard
          </span>
        </div>

        <div className="relative z-10 max-w-xl mt-10 lg:mt-0">
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-white leading-tight tracking-tight mb-4">
            Smart rider safety and emergency response when every second matters
          </h1>
          <p className="text-sm lg:text-base text-slate-200 leading-relaxed mb-8">
            Combine real-time GPS tracking, accelerometer crash detection, encrypted medical records,
            and priority emergency alerts in one reliable safety platform for bike riders.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-white/15 pt-6 text-xs text-slate-200">
            <div>
              <div className="font-semibold text-white mb-1">Sensor Crash Watch</div>
              <p className="text-slate-300">Accelerometer &amp; gyroscope monitoring with false-alarm countdown</p>
            </div>
            <div>
              <div className="font-semibold text-white mb-1">Encrypted Medical ID</div>
              <p className="text-slate-300">Blood group, allergies, and AES-GCM masked Aadhaar vault</p>
            </div>
            <div>
              <div className="font-semibold text-white mb-1">Live GPS &amp; Hospitals</div>
              <p className="text-slate-300">Shareable tracking link and automatic nearest hospital finder</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Authentication Form Column */}
      <div className="lg:col-span-5 flex items-center justify-center p-6 sm:p-10 lg:p-12 bg-white">
        <div className="w-full max-w-md space-y-5">
          <div>
            <h2 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
              Sign in or Register
            </h2>
            <p className="text-sm text-slate-600 mt-1.5">
              Create a new rider account or log in instantly using any Google / Gmail account.
            </p>
          </div>

          {error && (
            <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-red-900 text-xs leading-relaxed space-y-2.5">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span>{error.message}</span>
              </div>

              {error.code === 'auth/operation-not-allowed' && (
                <div className="pl-6 flex flex-wrap items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleGoogleSignIn}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer"
                  >
                    Continue with Google Now
                  </button>
                  <a
                    href={firebaseProvidersUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-900 bg-white border border-red-300 hover:bg-red-100 rounded-md"
                  >
                    Open Firebase Console
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {error.code === 'auth/unauthorized-domain' && (
                <div className="pl-6 flex flex-wrap items-center gap-2 pt-0.5">
                  {currentHost && (
                    <button
                      type="button"
                      onClick={() => void handleCopyDomain()}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-red-300 hover:bg-red-100 rounded-md cursor-pointer"
                    >
                      {copiedDomain ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      {copiedDomain ? 'Domain Copied' : `Copy ${currentHost}`}
                    </button>
                  )}
                  <a
                    href={firebaseDomainsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-md"
                  >
                    Open Authorized Domains
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {error.code === 'auth/email-already-in-use' && (
                <div className="pl-6">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signin');
                      setError(null);
                    }}
                    className="text-xs font-semibold text-red-800 underline cursor-pointer"
                  >
                    Switch to Sign In with this email →
                  </button>
                </div>
              )}
            </div>
          )}

          {notice && (
            <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs leading-relaxed flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              <span>{notice}</span>
            </div>
          )}

          {/* Primary Verified Google Sign-In & Registration (Works immediately for ANY Google account) */}
          <div className="space-y-3">
            <button
              type="button"
              disabled={busy}
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#ffffff"
                  d="M21.35 11.1h-9.18v2.92h5.27c-.23 1.48-1.71 4.35-5.27 4.35-3.17 0-5.76-2.63-5.76-5.87s2.59-5.87 5.76-5.87c1.81 0 3.02.77 3.71 1.43l2.53-2.44C16.79 4.1 14.69 3.2 12.17 3.2 7.1 3.2 3 7.3 3 12.5s4.1 9.3 9.17 9.3c5.3 0 8.81-3.72 8.81-8.96 0-.6-.06-1.06-.15-1.74z"
                />
              </svg>
              <span>{busy ? 'Connecting...' : 'Sign In with Google'}</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              <UserPlus className="w-4 h-4 shrink-0" />
              <span>Register or Switch to Another Google Email</span>
            </button>

            <p className="text-[11px] text-slate-500 leading-relaxed text-center">
              Works with <strong>any Gmail or Google-linked email</strong> — in the popup, tap{' '}
              <strong>Use another account</strong> to log in or auto-register a new rider profile immediately.
            </p>
          </div>

          {/* Collapsible Email & Password Option (for projects where Email/Password is enabled in Firebase Console) */}
          <div className="border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowEmailForm((v) => !v);
                setError(null);
              }}
              className="w-full flex items-center justify-between text-xs font-medium text-slate-600 hover:text-slate-900 py-1 cursor-pointer"
            >
              <span>Use Email &amp; Password instead (optional Firebase Console setup)</span>
              {showEmailForm ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showEmailForm && (
              <div className="mt-4 space-y-4">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
                  <strong>One-time setup required for password login:</strong> Enable{' '}
                  <strong>Email/Password</strong> in{' '}
                  <a
                    href={firebaseProvidersUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-900 font-semibold underline inline-flex items-center gap-0.5"
                  >
                    Firebase Console → Authentication → Sign-in method
                    <ExternalLink className="w-3 h-3 inline" />
                  </a>
                  . Otherwise, use the Google buttons above for instant access with any email.
                </div>

                {/* Mode Tabs */}
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signin');
                      setError(null);
                      setNotice(null);
                    }}
                    className={`py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      mode === 'signin' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                      setNotice(null);
                    }}
                    className={`py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Register
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setError(null);
                      setNotice(null);
                    }}
                    className={`py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      mode === 'reset' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Forgot Password
                  </button>
                </div>

                <form onSubmit={handleEmailSubmit} className="space-y-3.5">
                  {mode === 'register' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="auth-fullname">
                        Full Name
                      </label>
                      <div className="relative">
                        <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          id="auth-fullname"
                          type="text"
                          autoComplete="name"
                          required
                          maxLength={120}
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="e.g. Aarav Sharma"
                          className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="auth-email">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        id="auth-email"
                        type="email"
                        autoComplete="email"
                        required
                        maxLength={160}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="rider@example.com"
                        className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
                      />
                    </div>
                  </div>

                  {mode !== 'reset' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="auth-password">
                        Password
                      </label>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          id="auth-password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                          required
                          minLength={mode === 'register' ? 8 : 6}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={mode === 'register' ? 'Minimum 8 characters' : 'Enter your password'}
                          className="w-full pl-9 pr-10 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {mode === 'register' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="auth-confirm">
                        Confirm Password
                      </label>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          id="auth-confirm"
                          type={showConfirmPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          required
                          minLength={8}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Re-enter password"
                          className="w-full pl-9 pr-10 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                          aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                        >
                          {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                  >
                    <span>
                      {busy
                        ? 'Please wait...'
                        : mode === 'signin'
                          ? 'Sign In with Email'
                          : mode === 'register'
                            ? 'Create Account'
                            : 'Send Reset Email'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            Biometric fingerprint unlock can be enrolled under My Profile after signing in.
            Sensitive medical records and Aadhaar numbers are encrypted and isolated per rider account.
          </p>
        </div>
      </div>
    </div>
  );
};

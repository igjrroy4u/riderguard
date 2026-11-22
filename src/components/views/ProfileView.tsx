import React, { useEffect, useState } from 'react';
import { sendPasswordResetEmail, updatePassword } from 'firebase/auth';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  Camera,
  CheckCircle2,
  Fingerprint,
  KeyRound,
  Save,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  checkBiometricSupport,
  enrollBiometricCredential,
  verifyBiometricCredential,
} from '../../lib/biometric';
import { calculateAgeFromDob, compressImageFile } from '../../lib/geo';
import { DEFAULT_AVATAR_URL, type RiderProfile } from '../../types';

interface ProfileViewProps {
  profile: RiderProfile | null;
}

export const ProfileView: React.FC<ProfileViewProps> = ({ profile }) => {
  const [fullName, setFullName] = useState(profile?.fullName || '');
  const [mobileNumber, setMobileNumber] = useState(profile?.mobileNumber || '');
  const [dateOfBirth, setDateOfBirth] = useState(profile?.dateOfBirth || '');
  const [age, setAge] = useState<number>(profile?.age || 0);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState(profile?.profilePhotoUrl || '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [bioSupport, setBioSupport] = useState<{ supported: boolean; reason: string }>({
    supported: false,
    reason: 'Checking platform biometric hardware...',
  });
  const [bioBusy, setBioBusy] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    if (profile) {
      setFullName(profile.fullName);
      setMobileNumber(profile.mobileNumber);
      setDateOfBirth(profile.dateOfBirth);
      setAge(profile.age);
      setProfilePhotoUrl(profile.profilePhotoUrl);
    }
  }, [profile]);

  useEffect(() => {
    void checkBiometricSupport().then(setBioSupport);
  }, []);

  const handleDobChange = (val: string) => {
    setDateOfBirth(val);
    const computed = calculateAgeFromDob(val);
    if (computed > 0) setAge(computed);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);
    try {
      const compressed = await compressImageFile(file, 240, 0.72);
      setProfilePhotoUrl(compressed);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to process image file.',
      });
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setFeedback(null);
    const path = `riders/${profile.uid}`;
    try {
      await updateDoc(doc(db, 'riders', profile.uid), {
        fullName: fullName.trim().slice(0, 120),
        mobileNumber: mobileNumber.trim().slice(0, 24),
        dateOfBirth: dateOfBirth.trim().slice(0, 20),
        age: Math.max(0, Math.min(130, Number(age) || 0)),
        profilePhotoUrl: profilePhotoUrl.slice(0, 65000),
        updatedAt: serverTimestamp(),
      });
      setFeedback({ type: 'ok', text: 'Rider profile saved to Firestore.' });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    } finally {
      setSaving(false);
    }
  };

  const handleEnrollBiometric = async () => {
    if (!profile) return;
    setBioBusy(true);
    setFeedback(null);
    const path = `riders/${profile.uid}`;
    try {
      const credId = await enrollBiometricCredential({
        uid: profile.uid,
        email: profile.email,
        fullName: profile.fullName,
      });
      await updateDoc(doc(db, 'riders', profile.uid), {
        biometricEnabled: true,
        biometricCredentialId: credId.slice(0, 256),
        updatedAt: serverTimestamp(),
      });
      setFeedback({
        type: 'ok',
        text: 'Fingerprint / biometric passkey enrolled and linked to your RiderGuard account.',
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('Firestore')) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Biometric enrollment failed.',
      });
    } finally {
      setBioBusy(false);
    }
  };

  const handleVerifyBiometric = async () => {
    if (!profile?.biometricCredentialId) return;
    setBioBusy(true);
    setFeedback(null);
    try {
      const ok = await verifyBiometricCredential(profile.biometricCredentialId);
      setFeedback({
        type: ok ? 'ok' : 'err',
        text: ok
          ? 'Biometric fingerprint verification succeeded.'
          : 'Biometric verification was not completed.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Biometric verification failed.',
      });
    } finally {
      setBioBusy(false);
    }
  };

  const handleDisableBiometric = async () => {
    if (!profile) return;
    setBioBusy(true);
    const path = `riders/${profile.uid}`;
    try {
      await updateDoc(doc(db, 'riders', profile.uid), {
        biometricEnabled: false,
        biometricCredentialId: '',
        updatedAt: serverTimestamp(),
      });
      setFeedback({ type: 'ok', text: 'Biometric authentication disabled for this profile.' });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    } finally {
      setBioBusy(false);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    setFeedback(null);
    if (newPassword.length < 8) {
      setFeedback({ type: 'err', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFeedback({ type: 'err', text: 'Passwords do not match.' });
      return;
    }
    setPwBusy(true);
    try {
      await updatePassword(auth.currentUser, newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setFeedback({ type: 'ok', text: 'Account password updated successfully.' });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/requires-recent-login') {
        setFeedback({
          type: 'err',
          text: 'For security, please sign out and sign in again before changing your password, or use Send Reset Email.',
        });
      } else {
        setFeedback({
          type: 'err',
          text: err instanceof Error ? err.message : 'Unable to update password.',
        });
      }
    } finally {
      setPwBusy(false);
    }
  };

  const handleSendResetEmail = async () => {
    if (!profile?.email) return;
    setPwBusy(true);
    setFeedback(null);
    try {
      await sendPasswordResetEmail(auth, profile.email);
      setFeedback({
        type: 'ok',
        text: `Password reset email sent to ${profile.email}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to send password reset email.',
      });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">My Profile & Account Security</h1>
        <p className="text-sm text-slate-600 mt-1">
          Keep your identity, contact number, biometric lock, and credentials current for emergency responders.
        </p>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-lg border text-xs flex items-start gap-2.5 ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSaveProfile}
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          <div className="flex items-center gap-5 pb-5 border-b border-slate-100">
            <img
              src={profilePhotoUrl || DEFAULT_AVATAR_URL}
              alt="Rider profile portrait"
              referrerPolicy="no-referrer"
              className="w-20 h-20 rounded-full object-cover border border-slate-200 bg-slate-100 shrink-0"
            />
            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-900">
                {profile?.fullName || 'Rider'}
              </div>
              <div className="text-xs text-slate-500">
                Role: <span className="font-medium text-slate-900 capitalize">{profile?.role || 'rider'}</span> ·{' '}
                UID <span className="font-mono-tabular">{profile?.uid.slice(0, 10)}</span>
              </div>
              <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer">
                <Camera className="w-3.5 h-3.5" />
                Upload Photo
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="prof-name">
                Full Name
              </label>
              <input
                id="prof-name"
                type="text"
                required
                maxLength={120}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="prof-email">
                Email Address (Verified Account)
              </label>
              <input
                id="prof-email"
                type="email"
                disabled
                value={profile?.email || ''}
                className="w-full px-3 py-2 text-sm border border-slate-200 bg-slate-50 text-slate-500 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="prof-mobile">
                Mobile Number
              </label>
              <input
                id="prof-mobile"
                type="tel"
                maxLength={24}
                placeholder="+91 98765 43210"
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="prof-dob">
                Date of Birth
              </label>
              <input
                id="prof-dob"
                type="date"
                value={dateOfBirth}
                onChange={(e) => handleDobChange(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="prof-age">
                Age (Years)
              </label>
              <input
                id="prof-age"
                type="number"
                min={0}
                max={130}
                value={age}
                onChange={(e) => setAge(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving Profile...' : 'Save Profile'}
            </button>
          </div>
        </form>

        <div className="lg:col-span-5 space-y-6">
          {/* Biometric Fingerprint Authentication */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Fingerprint className="w-5 h-5 text-slate-900" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                Biometric Fingerprint Login
              </h2>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {bioSupport.reason}
            </p>

            <div className="text-xs text-slate-700 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-slate-500" />
              <span>
                Status:{' '}
                <strong className={profile?.biometricEnabled ? 'text-emerald-700' : 'text-slate-700'}>
                  {profile?.biometricEnabled ? 'Enrolled on Device' : 'Not Enrolled'}
                </strong>
              </span>
            </div>

            <div className="flex flex-wrap gap-2.5 pt-1">
              {!profile?.biometricEnabled ? (
                <button
                  type="button"
                  disabled={!bioSupport.supported || bioBusy}
                  onClick={handleEnrollBiometric}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  <Fingerprint className="w-4 h-4" />
                  {bioBusy ? 'Waiting for Biometric...' : 'Enroll Fingerprint / Passkey'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={!bioSupport.supported || bioBusy}
                    onClick={handleVerifyBiometric}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg cursor-pointer"
                  >
                    <Fingerprint className="w-4 h-4" />
                    Test Biometric Verify
                  </button>
                  <button
                    type="button"
                    disabled={bioBusy}
                    onClick={handleDisableBiometric}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                  >
                    Remove Biometric
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Password Management */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <KeyRound className="w-5 h-5 text-slate-900" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                Password Management
              </h2>
            </div>

            <form onSubmit={handlePasswordUpdate} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="new-pw">
                  New Password
                </label>
                <input
                  id="new-pw"
                  type="password"
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="confirm-pw">
                  Confirm New Password
                </label>
                <input
                  id="confirm-pw"
                  type="password"
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <div className="flex flex-wrap gap-2.5 pt-1">
                <button
                  type="submit"
                  disabled={pwBusy}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  Update Password
                </button>
                <button
                  type="button"
                  disabled={pwBusy}
                  onClick={handleSendResetEmail}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Send Password Reset Email
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  HeartPulse,
  Lock,
  Save,
  Shield,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { decryptAadhaar, encryptAadhaar, normalizeAadhaar } from '../../lib/crypto';
import type { MedicalRecord, RiderProfile } from '../../types';

interface MedicalViewProps {
  profile: RiderProfile | null;
  medical: MedicalRecord | null;
}

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'];

export const MedicalView: React.FC<MedicalViewProps> = ({ profile, medical }) => {
  const [bloodGroup, setBloodGroup] = useState(medical?.bloodGroup || '');
  const [medicalConditions, setMedicalConditions] = useState(medical?.medicalConditions || '');
  const [allergies, setAllergies] = useState(medical?.allergies || '');
  const [medicalHistory, setMedicalHistory] = useState(medical?.medicalHistory || '');
  const [emergencyInstructions, setEmergencyInstructions] = useState(
    medical?.emergencyInstructions || ''
  );

  // Aadhaar Encryption Vault controls
  const [aadhaarInput, setAadhaarInput] = useState('');
  const [vaultPin, setVaultPin] = useState('');
  const [unlockPin, setUnlockPin] = useState('');
  const [revealedAadhaar, setRevealedAadhaar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (medical) {
      setBloodGroup(medical.bloodGroup || '');
      setMedicalConditions(medical.medicalConditions || '');
      setAllergies(medical.allergies || '');
      setMedicalHistory(medical.medicalHistory || '');
      setEmergencyInstructions(medical.emergencyInstructions || '');
    }
  }, [medical]);

  const handleSaveMedical = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setFeedback(null);

    let aadhaarMasked = medical?.aadhaarMasked || '';
    let aadhaarEncrypted = medical?.aadhaarEncrypted || '';
    let encryptionIv = medical?.encryptionIv || '';
    let encryptionSalt = medical?.encryptionSalt || '';

    try {
      const digits = normalizeAadhaar(aadhaarInput);
      if (digits.length > 0) {
        const encrypted = await encryptAadhaar(digits, vaultPin, profile.uid);
        aadhaarMasked = encrypted.masked;
        aadhaarEncrypted = encrypted.ciphertext;
        encryptionIv = encrypted.iv;
        encryptionSalt = encrypted.salt;
      }
    } catch (err) {
      setSaving(false);
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to encrypt Aadhaar number.',
      });
      return;
    }

    const path = `riders/${profile.uid}/medical/record`;
    try {
      await setDoc(doc(db, 'riders', profile.uid, 'medical', 'record'), {
        riderId: profile.uid,
        bloodGroup: bloodGroup.trim().slice(0, 10),
        medicalConditions: medicalConditions.trim().slice(0, 500),
        allergies: allergies.trim().slice(0, 500),
        medicalHistory: medicalHistory.trim().slice(0, 1500),
        emergencyInstructions: emergencyInstructions.trim().slice(0, 1000),
        aadhaarMasked: aadhaarMasked.slice(0, 24),
        aadhaarEncrypted: aadhaarEncrypted.slice(0, 600),
        encryptionIv: encryptionIv.slice(0, 64),
        encryptionSalt: encryptionSalt.slice(0, 64),
        updatedAt: serverTimestamp(),
      });
      setAadhaarInput('');
      setVaultPin('');
      setRevealedAadhaar(null);
      setFeedback({
        type: 'ok',
        text: 'Medical history saved securely. Aadhaar data is stored only as AES-GCM ciphertext and masked digits.',
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setSaving(false);
    }
  };

  const handleRevealAadhaar = async () => {
    if (!profile || !medical?.aadhaarEncrypted) return;
    setFeedback(null);
    try {
      const plain = await decryptAadhaar(
        medical.aadhaarEncrypted,
        medical.encryptionIv,
        medical.encryptionSalt,
        unlockPin,
        profile.uid
      );
      setRevealedAadhaar(plain);
      setUnlockPin('');
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to decrypt Aadhaar record.',
      });
    }
  };

  const handleClearAadhaar = async () => {
    if (!profile) return;
    setSaving(true);
    const path = `riders/${profile.uid}/medical/record`;
    try {
      await setDoc(doc(db, 'riders', profile.uid, 'medical', 'record'), {
        riderId: profile.uid,
        bloodGroup: bloodGroup.trim().slice(0, 10),
        medicalConditions: medicalConditions.trim().slice(0, 500),
        allergies: allergies.trim().slice(0, 500),
        medicalHistory: medicalHistory.trim().slice(0, 1500),
        emergencyInstructions: emergencyInstructions.trim().slice(0, 1000),
        aadhaarMasked: '',
        aadhaarEncrypted: '',
        encryptionIv: '',
        encryptionSalt: '',
        updatedAt: serverTimestamp(),
      });
      setRevealedAadhaar(null);
      setFeedback({ type: 'ok', text: 'Stored Aadhaar record permanently erased.' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">
          Medical Information & Protected Vault
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Critical medical details are shared with authorized emergency contacts during an active SOS. Aadhaar stays AES-GCM encrypted and masked.
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
          onSubmit={handleSaveMedical}
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="med-blood">
                Blood Group
              </label>
              <select
                id="med-blood"
                value={bloodGroup}
                onChange={(e) => setBloodGroup(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="">Select blood group</option>
                {BLOOD_GROUPS.map((bg) => (
                  <option key={bg} value={bg}>
                    {bg}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="med-allergies">
                Known Allergies
              </label>
              <input
                id="med-allergies"
                type="text"
                maxLength={500}
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder="e.g. Penicillin, Sulfa drugs, Latex"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="med-conditions">
                Medical Conditions
              </label>
              <input
                id="med-conditions"
                type="text"
                maxLength={500}
                value={medicalConditions}
                onChange={(e) => setMedicalConditions(e.target.value)}
                placeholder="e.g. Asthma, Type 1 Diabetes, Hypertension"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="med-history">
                Existing Medical History & Current Medications
              </label>
              <textarea
                id="med-history"
                rows={3}
                maxLength={1500}
                value={medicalHistory}
                onChange={(e) => setMedicalHistory(e.target.value)}
                placeholder="Past surgeries, implants, daily medications, physician notes..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="med-instructions">
                Emergency Medical Instructions for Responders
              </label>
              <textarea
                id="med-instructions"
                rows={3}
                maxLength={1000}
                value={emergencyInstructions}
                onChange={(e) => setEmergencyInstructions(e.target.value)}
                placeholder="e.g. Inhaler in left jacket pocket. Notify primary contact before administering anesthesia."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          {/* Optional AES-GCM Encrypted Aadhaar Entry */}
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Lock className="w-4 h-4 text-slate-700" />
              <span>Optional Aadhaar Vault (AES-GCM 256-bit Encrypted)</span>
            </div>
            <p className="text-xs text-slate-500">
              Your 12-digit Aadhaar is encrypted locally in your browser with PBKDF2 + AES-GCM before storage. Only the masked value (XXXX-XXXX-1234) and encrypted ciphertext are stored.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="aadhaar-num">
                  12-Digit Aadhaar Number (leave blank to keep existing)
                </label>
                <input
                  id="aadhaar-num"
                  type="text"
                  inputMode="numeric"
                  maxLength={14}
                  value={aadhaarInput}
                  onChange={(e) => setAadhaarInput(e.target.value)}
                  placeholder="1234 5678 9012"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="vault-pin">
                  Vault Encryption PIN (min 4 chars)
                </label>
                <input
                  id="vault-pin"
                  type="password"
                  maxLength={32}
                  value={vaultPin}
                  onChange={(e) => setVaultPin(e.target.value)}
                  placeholder="Required when updating Aadhaar"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Encrypting & Saving...' : 'Save Medical Record'}
          </button>
        </form>

        {/* Right Column: Emergency Responder Card + Encrypted Aadhaar Reveal */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-red-200 rounded-xl overflow-hidden">
            <div className="bg-red-600 px-5 py-3.5 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 font-display font-semibold text-sm">
                <HeartPulse className="w-4 h-4" />
                <span>Emergency Responder Medical Card</span>
              </div>
              <span className="font-mono-tabular text-base font-bold">
                {bloodGroup || 'Blood N/A'}
              </span>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 pb-3 border-b border-slate-100">
                <div>
                  <div className="text-slate-500">Rider Name</div>
                  <div className="font-semibold text-slate-900 text-sm">
                    {profile?.fullName || 'Not set'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Age / Mobile</div>
                  <div className="font-mono-tabular text-slate-900">
                    {profile?.age ? `${profile.age} yrs` : '—'} · {profile?.mobileNumber || '—'}
                  </div>
                </div>
              </div>
              <div>
                <div className="text-slate-500 font-medium">Allergies</div>
                <div className="text-slate-900 mt-0.5">{allergies || 'None reported'}</div>
              </div>
              <div>
                <div className="text-slate-500 font-medium">Conditions</div>
                <div className="text-slate-900 mt-0.5">{medicalConditions || 'None reported'}</div>
              </div>
              <div>
                <div className="text-slate-500 font-medium">Medical History</div>
                <div className="text-slate-900 mt-0.5 whitespace-pre-line">
                  {medicalHistory || 'No medical history recorded'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 font-medium">Responder Instructions</div>
                <div className="text-slate-900 mt-0.5 whitespace-pre-line">
                  {emergencyInstructions || 'Follow standard emergency trauma protocol.'}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-display text-sm font-semibold text-slate-900">
                <Shield className="w-4 h-4 text-slate-700" />
                <span>Stored Aadhaar Identity Vault</span>
              </div>
              <span className="font-mono-tabular text-xs font-semibold text-slate-900">
                {medical?.aadhaarMasked || 'Not Stored'}
              </span>
            </div>

            {medical?.aadhaarEncrypted ? (
              <div className="space-y-3">
                {revealedAadhaar ? (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                    <span className="font-mono-tabular text-sm font-bold text-slate-900">
                      {revealedAadhaar}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRevealedAadhaar(null)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      Hide
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={unlockPin}
                      onChange={(e) => setUnlockPin(e.target.value)}
                      placeholder="Enter Vault PIN to decrypt"
                      className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <button
                      type="button"
                      onClick={handleRevealAadhaar}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Reveal
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleClearAadhaar}
                  className="text-xs text-red-700 hover:underline cursor-pointer"
                >
                  Erase Stored Aadhaar Data
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                No Aadhaar number is currently stored. Adding Aadhaar is optional and encrypted client-side before upload.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

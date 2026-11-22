import React, { useEffect, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { CheckCircle2, Save, ShieldCheck, Sliders } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { PWAInstallButton } from '../PWAInstallButton';
import type { NavSection, RiderProfile } from '../../types';

interface SettingsViewProps {
  profile: RiderProfile | null;
  smsGatewayConfigured: boolean;
  onNavigate: (section: NavSection) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  profile,
  smsGatewayConfigured,
  onNavigate,
}) => {
  const [countdownSec, setCountdownSec] = useState(profile?.accidentCountdownSec ?? 15);
  const [impactThresholdG, setImpactThresholdG] = useState(profile?.impactThresholdG ?? 3.2);
  const [autoSmsEnabled, setAutoSmsEnabled] = useState(profile?.autoSmsEnabled ?? true);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setCountdownSec(profile.accidentCountdownSec);
      setImpactThresholdG(profile.impactThresholdG);
      setAutoSmsEnabled(profile.autoSmsEnabled);
    }
  }, [profile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setSavedNotice(null);
    const path = `riders/${profile.uid}`;
    try {
      await updateDoc(doc(db, 'riders', profile.uid), {
        accidentCountdownSec: Math.max(5, Math.min(60, Number(countdownSec) || 15)),
        impactThresholdG: Math.max(1.5, Math.min(8.0, Number(impactThresholdG) || 3.2)),
        autoSmsEnabled: Boolean(autoSmsEnabled),
        updatedAt: serverTimestamp(),
      });
      setSavedNotice('Safety and accident detection settings saved.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Safety Settings</h1>
        <p className="text-sm text-slate-600 mt-1">
          Configure crash sensitivity, false-alarm confirmation countdown, and notification preferences.
        </p>
      </div>

      {savedNotice && (
        <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{savedNotice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSave}
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6"
        >
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
            <Sliders className="w-4 h-4 text-slate-900" />
            <h2 className="font-display text-base font-semibold text-slate-900">
              Accident Detection Calibration
            </h2>
          </div>

          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-700" htmlFor="set-countdown">
                  False-Alarm Cancellation Countdown
                </label>
                <span className="font-mono-tabular text-sm font-bold text-slate-900">
                  {countdownSec} seconds
                </span>
              </div>
              <input
                id="set-countdown"
                type="range"
                min={5}
                max={60}
                step={1}
                value={countdownSec}
                onChange={(e) => setCountdownSec(Number(e.target.value))}
                className="w-full accent-slate-900 cursor-pointer"
              />
              <p className="text-xs text-slate-500 mt-1">
                Time allowed to tap "I Am Safe — Cancel False Alarm" after an impact spike before SOS automatically fires.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-700" htmlFor="set-threshold">
                  Impact G-Force Trigger Threshold
                </label>
                <span className="font-mono-tabular text-sm font-bold text-slate-900">
                  {impactThresholdG.toFixed(1)} G
                </span>
              </div>
              <input
                id="set-threshold"
                type="range"
                min={1.5}
                max={8.0}
                step={0.1}
                value={impactThresholdG}
                onChange={(e) => setImpactThresholdG(Number(e.target.value))}
                className="w-full accent-slate-900 cursor-pointer"
              />
              <p className="text-xs text-slate-500 mt-1">
                Lower values (2.0G–2.5G) are more sensitive; 3.0G–4.0G reduces false triggers on rough roads.
              </p>
            </div>

            <div className="pt-2 border-t border-slate-100">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSmsEnabled}
                  onChange={(e) => setAutoSmsEnabled(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  <strong className="block text-slate-900">
                    Dispatch Automatic Emergency SMS Alerts
                  </strong>
                  Attempt server-side carrier SMS dispatch (when configured) and queue device SMS handoff for all priority contacts upon SOS activation.
                </span>
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg cursor-pointer"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving Settings...' : 'Save Safety Settings'}
          </button>
        </form>

        <div className="lg:col-span-5 space-y-4">
          <PWAInstallButton variant="card" />

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3 text-xs">
            <div className="flex items-center gap-2 font-display text-sm font-semibold text-slate-900">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Security & Privacy Controls</span>
            </div>
            <p className="text-slate-600 leading-relaxed">
              Biometric fingerprint enrollment, password updates, and account verification are managed in your Profile section.
            </p>
            <p className="text-slate-600 leading-relaxed">
              SMS Carrier Status:{' '}
              <strong className="text-slate-900">
                {smsGatewayConfigured
                  ? 'Twilio Carrier Gateway Configured'
                  : 'Device SMS Handoff Mode (Set TWILIO_* server secrets for automatic carrier SMS)'}
              </strong>
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={() => onNavigate('profile')}
                className="px-3.5 py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Manage Biometric & Password
              </button>
              <button
                type="button"
                onClick={() => onNavigate('medical')}
                className="px-3.5 py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Aadhaar Encryption Vault
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

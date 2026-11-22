import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { playAlertBeep } from '../lib/geo';

interface EmergencyCountdownModalProps {
  open: boolean;
  countdownSeconds: number;
  detectedGForce: number;
  detectedTilt: number;
  isDrill: boolean;
  onCancelFalseAlarm: () => void;
  onConfirmEmergency: () => void;
}

export const EmergencyCountdownModal: React.FC<EmergencyCountdownModalProps> = ({
  open,
  countdownSeconds,
  detectedGForce,
  detectedTilt,
  isDrill,
  onCancelFalseAlarm,
  onConfirmEmergency,
}) => {
  const [remaining, setRemaining] = useState(countdownSeconds);

  useEffect(() => {
    if (!open) return;
    setRemaining(countdownSeconds);
    playAlertBeep(true);

    const timer = window.setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          onConfirmEmergency();
          return 0;
        }
        playAlertBeep(prev <= 5);
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [open, countdownSeconds, onConfirmEmergency]);

  if (!open) return null;

  const progressPct = Math.max(0, Math.min(100, (remaining / Math.max(1, countdownSeconds)) * 100));

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="crash-modal-title"
    >
      <div className="w-full max-w-lg bg-white border border-red-200 rounded-2xl overflow-hidden shadow-2xl">
        <div className="bg-red-600 px-6 py-5 text-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-7 h-7 shrink-0" />
            <div>
              <h2 id="crash-modal-title" className="font-display text-xl font-bold leading-tight">
                {isDrill ? 'Impact Detection Drill Triggered' : 'Possible Accident Detected'}
              </h2>
              <p className="text-xs text-red-100 mt-0.5">
                Confirm you are safe before automatic SOS alert is dispatched
              </p>
            </div>
          </div>
          <div className="font-mono-tabular text-3xl font-bold bg-red-700/80 px-3.5 py-1.5 rounded-lg">
            {remaining}s
          </div>
        </div>

        <div className="h-1.5 bg-red-100 w-full">
          <div
            className="h-full bg-red-600 transition-all duration-1000 ease-linear"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4 py-3 border-y border-slate-200 text-sm">
            <div>
              <div className="text-xs text-slate-500">Measured Impact Force</div>
              <div className="font-mono-tabular text-lg font-semibold text-slate-900 mt-0.5">
                {detectedGForce.toFixed(2)} G
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Measured Device Tilt</div>
              <div className="font-mono-tabular text-lg font-semibold text-slate-900 mt-0.5">
                {detectedTilt}°
              </div>
            </div>
          </div>

          <p className="text-sm text-slate-700 leading-relaxed">
            If you do not cancel within <strong className="font-mono-tabular">{remaining} seconds</strong>,
            RiderGuard will automatically activate an emergency session, share your live GPS coordinates
            and essential medical summary with your emergency contacts, and identify the nearest hospital.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <button
              type="button"
              onClick={onCancelFalseAlarm}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors cursor-pointer"
            >
              <CheckCircle2 className="w-5 h-5" />
              I Am Safe — Cancel False Alarm
            </button>
            <button
              type="button"
              onClick={onConfirmEmergency}
              className="inline-flex items-center justify-center gap-2 px-5 py-3.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
            >
              <ShieldAlert className="w-4 h-4" />
              Send SOS Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

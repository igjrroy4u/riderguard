import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Share,
  Smartphone,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      setCopiedUrl(false);
    }
  };

  if (variant === 'card') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-display text-sm font-semibold text-slate-900">
            <Smartphone className="w-4 h-4 text-slate-900" />
            <span>Install RiderGuard Mobile &amp; Desktop App</span>
          </div>
          {isInstalled && (
            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Installed
            </span>
          )}
        </div>

        {isInstalled ? (
          <p className="text-slate-600 leading-relaxed">
            RiderGuard is running as an installed standalone application with offline caching enabled.
          </p>
        ) : (
          <>
            <p className="text-slate-600 leading-relaxed">
              Install RiderGuard directly onto your Android, iPhone, or desktop home screen for full-screen launch, faster SOS access, and offline emergency profile availability.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {isInstallable ? (
                <button
                  type="button"
                  onClick={() => void install()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Install RiderGuard App
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowGuide(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  {isIOS ? 'Install on iPhone / iPad' : 'How to Install App'}
                </button>
              )}
              {isInIframe && appUrl && (
                <a
                  href={appUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open Full Tab to Install
                </a>
              )}
            </div>
          </>
        )}

        {showGuide && (
          <InstallGuideModal
            isIOS={isIOS}
            isInIframe={isInIframe}
            appUrl={appUrl}
            copiedUrl={copiedUrl}
            onCopyUrl={() => void handleCopyUrl()}
            onClose={() => setShowGuide(false)}
          />
        )}
      </div>
    );
  }

  // Header variant: automatically suppress when running as installed standalone app
  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition cursor-pointer whitespace-nowrap"
      >
        <Download className="w-3.5 h-3.5" />
        Install App
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition cursor-pointer whitespace-nowrap"
      >
        <Download className="w-3.5 h-3.5" />
        {isIOS ? 'Install on iOS' : 'Install App'}
      </button>

      {showGuide && (
        <InstallGuideModal
          isIOS={isIOS}
          isInIframe={isInIframe}
          appUrl={appUrl}
          copiedUrl={copiedUrl}
          onCopyUrl={() => void handleCopyUrl()}
          onClose={() => setShowGuide(false)}
        />
      )}
    </>
  );
};

interface InstallGuideModalProps {
  isIOS: boolean;
  isInIframe: boolean;
  appUrl: string;
  copiedUrl: boolean;
  onCopyUrl: () => void;
  onClose: () => void;
}

const InstallGuideModal: React.FC<InstallGuideModalProps> = ({
  isIOS,
  isInIframe,
  appUrl,
  copiedUrl,
  onCopyUrl,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-white border border-slate-200 p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <img
              src="/pwa-192x192.png"
              alt="RiderGuard App Icon"
              className="w-10 h-10 rounded-xl border border-slate-200"
            />
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                {isIOS ? 'Install RiderGuard on iPhone / iPad' : 'Install RiderGuard App'}
              </h3>
              <p className="text-xs text-slate-500">
                Standalone app with home-screen icon &amp; offline support
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
            aria-label="Close install instructions"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isInIframe && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2">
            <p className="font-semibold">Open directly in your browser to enable one-tap install</p>
            <p className="leading-relaxed">
              Browsers disable app installation inside embedded previews. Open RiderGuard in a standalone browser tab on your phone or computer:
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {appUrl && (
                <a
                  href={appUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in New Tab
                </a>
              )}
              <button
                type="button"
                onClick={onCopyUrl}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedUrl ? 'App Link Copied' : 'Copy App Link'}
              </button>
            </div>
          </div>
        )}

        {isIOS ? (
          <ol className="space-y-2.5 text-xs text-slate-700 list-decimal pl-4 leading-relaxed">
            <li>
              Open this page in <strong>Safari</strong> on your iPhone or iPad.
            </li>
            <li>
              Tap the <strong className="inline-flex items-center gap-1">Share <Share className="w-3.5 h-3.5 inline" /></strong> button in Safari&apos;s toolbar.
            </li>
            <li>
              Scroll down and tap <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.
            </li>
          </ol>
        ) : (
          <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
            <div>
              <div className="font-semibold text-slate-900">Android (Chrome / Edge / Brave)</div>
              <p className="mt-0.5">
                Open the link in Chrome on your phone, then tap <strong>Install App</strong> in the top bar (or menu <strong>⋮</strong> → <strong>Install app</strong> / <strong>Add to Home screen</strong>).
              </p>
            </div>
            <div>
              <div className="font-semibold text-slate-900">iPhone / iPad (Safari)</div>
              <p className="mt-0.5">
                Open in Safari → tap <strong>Share</strong> → <strong>Add to Home Screen</strong>.
              </p>
            </div>
            <div>
              <div className="font-semibold text-slate-900">Desktop (Chrome / Edge)</div>
              <p className="mt-0.5">
                Open in a full browser tab and click <strong>Install App</strong> or the install icon in the address bar.
              </p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
        >
          Close
        </button>
      </div>
    </div>
  );
};

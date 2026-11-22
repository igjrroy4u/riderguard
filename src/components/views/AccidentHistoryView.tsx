import React, { useMemo, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { CheckCircle2, FileText, MapPin, Search, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { buildHospitalNavigationUrl, formatCoords, formatTimestamp } from '../../lib/geo';
import type { AccidentRecord } from '../../types';
import { StatusText } from '../StatusText';

interface AccidentHistoryViewProps {
  accidents: AccidentRecord[];
}

export const AccidentHistoryView: React.FC<AccidentHistoryViewProps> = ({ accidents }) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selected, setSelected] = useState<AccidentRecord | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accidents.filter((a) => {
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      if (!q) return true;
      return (
        a.id.toLowerCase().includes(q) ||
        a.locationAddress.toLowerCase().includes(q) ||
        a.bikeSummary.toLowerCase().includes(q) ||
        a.nearestHospitalName.toLowerCase().includes(q)
      );
    });
  }, [accidents, search, statusFilter]);

  const openDetails = (record: AccidentRecord) => {
    setSelected(record);
    setNoteInput(record.notes || '');
  };

  const handleSaveNotes = async () => {
    if (!selected) return;
    if (selected.status === 'RESOLVED' || selected.status === 'CANCELLED_FALSE_ALARM') return;
    setSavingNote(true);
    const path = `accidents/${selected.id}`;
    try {
      await updateDoc(doc(db, 'accidents', selected.id), {
        notes: noteInput.trim().slice(0, 1000),
        updatedAt: serverTimestamp(),
      });
      setSelected({ ...selected, notes: noteInput.trim().slice(0, 1000) });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">Accident & SOS History</h1>
        <p className="text-sm text-slate-600 mt-1">
          Complete immutable audit archive of every accident detection event, manual SOS, hospital route, and resolution status.
        </p>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {(['ALL', 'ACTIVE', 'RESOLVED', 'CANCELLED_FALSE_ALARM'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                statusFilter === tab
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab === 'ALL'
                ? `All (${accidents.length})`
                : tab === 'CANCELLED_FALSE_ALARM'
                  ? 'False Alarms'
                  : tab.charAt(0) + tab.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ID, bike, location, hospital..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-2">
          <FileText className="w-9 h-9 text-slate-300 mx-auto" />
          <h3 className="font-display text-base font-semibold text-slate-900">
            No accident records match your filter
          </h3>
          <p className="text-xs text-slate-500">
            Triggered SOS alerts, auto-detected impacts, and safety drills are permanently archived here.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                  <th className="py-3 px-4">Accident ID</th>
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-4">Location / GPS</th>
                  <th className="py-3 px-4">Bike Details</th>
                  <th className="py-3 px-4">Contacts</th>
                  <th className="py-3 px-4">Notification / SMS / Call</th>
                  <th className="py-3 px-4">Nearest Hospital</th>
                  <th className="py-3 px-4">Response / Resolution</th>
                  <th className="py-3 px-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50">
                    <td className="py-3.5 px-4 font-mono-tabular font-semibold text-slate-900 whitespace-nowrap">
                      {acc.id.slice(0, 12)}
                      <div className="mt-0.5 font-sans font-normal">
                        <StatusText status={acc.triggerType} />
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono-tabular text-slate-600 whitespace-nowrap">
                      {formatTimestamp(acc.createdAt)}
                    </td>
                    <td className="py-3.5 px-4 max-w-[210px]">
                      <div className="text-slate-900 truncate" title={acc.locationAddress}>
                        {acc.locationAddress || 'GPS coordinates only'}
                      </div>
                      <div className="font-mono-tabular text-slate-500">
                        {formatCoords(acc.latitude, acc.longitude)}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 max-w-[160px] truncate">
                      {acc.bikeSummary || 'Not specified'}
                    </td>
                    <td className="py-3.5 px-4 font-mono-tabular text-slate-900">
                      {acc.contactsNotifiedCount}
                    </td>
                    <td className="py-3.5 px-4 space-y-1">
                      <div>
                        <StatusText status={acc.notificationSummaryStatus} />
                      </div>
                      <div className="text-slate-500">
                        SMS: <StatusText status={acc.smsSummaryStatus} />
                      </div>
                      <div className="text-slate-500">
                        Call: <StatusText status={acc.callSummaryStatus} />
                      </div>
                    </td>
                    <td className="py-3.5 px-4 max-w-[180px]">
                      <div className="text-slate-900 truncate">
                        {acc.nearestHospitalName || 'Not located'}
                      </div>
                      {acc.nearestHospitalDistanceKm > 0 && (
                        <div className="font-mono-tabular text-slate-500">
                          {acc.nearestHospitalDistanceKm.toFixed(2)} km
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 space-y-1">
                      <div>
                        <StatusText status={acc.responseStatus} />
                      </div>
                      <div>
                        <StatusText status={acc.status} />
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openDetails(acc)}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer whitespace-nowrap"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detailed Incident Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <div className="font-mono-tabular text-xs text-slate-500">
                  Incident ID: {selected.id}
                </div>
                <h2 className="font-display text-xl font-bold text-slate-900 mt-0.5">
                  Accident Incident Report
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close report"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <dt className="text-slate-500">Date & Time</dt>
                <dd className="font-mono-tabular text-slate-900 font-medium mt-0.5">
                  {formatTimestamp(selected.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Trigger & Impact</dt>
                <dd className="mt-0.5 flex items-center gap-2">
                  <StatusText status={selected.triggerType} />
                  {selected.impactGForce > 0 && (
                    <span className="font-mono-tabular text-slate-700">
                      ({selected.impactGForce.toFixed(2)} G)
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Emergency Response</dt>
                <dd className="mt-0.5">
                  <StatusText status={selected.responseStatus} />
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Resolution Status</dt>
                <dd className="mt-0.5">
                  <StatusText status={selected.status} />
                  {selected.resolvedAtIso && (
                    <span className="block font-mono-tabular text-slate-500 mt-0.5">
                      Closed: {formatTimestamp(selected.resolvedAtIso)}
                    </span>
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Accident Location & Coordinates</dt>
                <dd className="text-slate-900 mt-0.5">
                  {selected.locationAddress || '—'}{' '}
                  <span className="font-mono-tabular text-slate-600">
                    ({formatCoords(selected.latitude, selected.longitude)})
                  </span>
                </dd>
                <a
                  href={buildHospitalNavigationUrl(selected.latitude, selected.longitude)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-slate-900 font-semibold underline mt-1"
                >
                  <MapPin className="w-3.5 h-3.5" /> Open Coordinates on Map
                </a>
              </div>
              <div>
                <dt className="text-slate-500">Registered Bike</dt>
                <dd className="text-slate-900 mt-0.5">{selected.bikeSummary || 'Not specified'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Nearest Hospital</dt>
                <dd className="text-slate-900 mt-0.5">
                  {selected.nearestHospitalName || 'Not located'}
                  {selected.nearestHospitalDistanceKm > 0 &&
                    ` (${selected.nearestHospitalDistanceKm.toFixed(2)} km)`}
                  {selected.nearestHospitalPhone && (
                    <span className="block font-mono-tabular text-slate-600">
                      {selected.nearestHospitalPhone}
                    </span>
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Medical Snapshot Shared</dt>
                <dd className="text-slate-800 whitespace-pre-line mt-0.5 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  {selected.medicalSnapshot || 'No medical record available at time of alert.'}
                </dd>
              </div>
            </dl>

            <div className="space-y-2 border-t border-slate-200 pt-4">
              <label className="block text-xs font-medium text-slate-700">Incident Notes</label>
              <textarea
                rows={2}
                disabled={
                  selected.status === 'RESOLVED' || selected.status === 'CANCELLED_FALSE_ALARM'
                }
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="Add incident notes while active..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg disabled:bg-slate-50 disabled:text-slate-500"
              />
              {selected.status !== 'RESOLVED' && selected.status !== 'CANCELLED_FALSE_ALARM' && (
                <button
                  type="button"
                  disabled={savingNote}
                  onClick={handleSaveNotes}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {savingNote ? 'Saving...' : 'Save Notes'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

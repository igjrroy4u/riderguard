import React, { useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  CheckCircle2,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { buildSmsHref, buildTelHref, generateSecureId } from '../../lib/geo';
import type { EmergencyContact, RiderProfile } from '../../types';

interface ContactsViewProps {
  profile: RiderProfile | null;
  contacts: EmergencyContact[];
}

interface ContactPickerNavigator extends Navigator {
  contacts?: {
    select: (
      properties: string[],
      options?: { multiple?: boolean }
    ) => Promise<Array<{ name?: string[]; tel?: string[]; email?: string[] }>>;
  };
}

const EMPTY_CONTACT = {
  name: '',
  relationship: '',
  mobileNumber: '',
  email: '',
  priority: 1,
  notifySms: true,
  notifyCall: true,
};

export const ContactsView: React.FC<ContactsViewProps> = ({ profile, contacts }) => {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_CONTACT);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const sortedContacts = [...contacts].sort((a, b) => a.priority - b.priority);
  const supportsContactPicker =
    typeof navigator !== 'undefined' && 'contacts' in navigator;

  const openAdd = () => {
    setEditingId(null);
    setForm({
      ...EMPTY_CONTACT,
      priority: Math.min(10, contacts.length + 1),
    });
    setShowForm(true);
    setFeedback(null);
  };

  const openEdit = (c: EmergencyContact) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      relationship: c.relationship,
      mobileNumber: c.mobileNumber,
      email: c.email,
      priority: c.priority,
      notifySms: c.notifySms,
      notifyCall: c.notifyCall,
    });
    setShowForm(true);
    setFeedback(null);
  };

  const handleImportFromDevice = async () => {
    const nav = navigator as ContactPickerNavigator;
    if (!nav.contacts?.select) return;
    try {
      const picked = await nav.contacts.select(['name', 'tel', 'email'], { multiple: false });
      const first = picked[0];
      if (!first) return;
      setEditingId(null);
      setForm({
        name: first.name?.[0] || '',
        relationship: 'Family / Contact',
        mobileNumber: first.tel?.[0] || '',
        email: first.email?.[0] || '',
        priority: Math.min(10, contacts.length + 1),
        notifySms: true,
        notifyCall: true,
      });
      setShowForm(true);
    } catch {
      setFeedback('Contact permission was declined or unavailable on this browser.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setBusy(true);
    setFeedback(null);

    const contactId = editingId || generateSecureId('ec', 20);
    const path = `emergencyContacts/${contactId}`;

    try {
      const payload = {
        name: form.name.trim().slice(0, 120),
        relationship: form.relationship.trim().slice(0, 60),
        mobileNumber: form.mobileNumber.trim().slice(0, 24),
        email: form.email.trim().slice(0, 160),
        priority: Math.max(1, Math.min(10, Number(form.priority) || 1)),
        notifySms: Boolean(form.notifySms),
        notifyCall: Boolean(form.notifyCall),
        updatedAt: serverTimestamp(),
      };

      if (editingId) {
        await updateDoc(doc(db, 'emergencyContacts', contactId), payload);
        setFeedback('Emergency contact updated.');
      } else {
        await setDoc(doc(db, 'emergencyContacts', contactId), {
          riderId: profile.uid,
          ...payload,
          createdAt: serverTimestamp(),
        });
        setFeedback('Emergency contact added.');
      }
      setShowForm(false);
    } catch (err) {
      handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, path);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (contact: EmergencyContact) => {
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'emergencyContacts', contact.id));
      setFeedback(`Removed ${contact.name} from emergency contacts.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `emergencyContacts/${contact.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Emergency Contacts</h1>
          <p className="text-sm text-slate-600 mt-1">
            Contacts are alerted in priority order during SOS or automatic crash detection with live GPS and medical info.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {supportsContactPicker && (
            <button
              type="button"
              onClick={handleImportFromDevice}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <UserPlus className="w-4 h-4" />
              Import Contact
            </button>
          )}
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add Contact
          </button>
        </div>
      </div>

      {feedback && (
        <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="font-display text-base font-semibold text-slate-900">
              {editingId ? 'Edit Emergency Contact' : 'Add Emergency Contact'}
            </h2>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              aria-label="Close form"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Contact Name *</label>
              <input
                type="text"
                required
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Priya Sharma"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Relationship *</label>
              <input
                type="text"
                required
                maxLength={60}
                value={form.relationship}
                onChange={(e) => setForm({ ...form, relationship: e.target.value })}
                placeholder="e.g. Spouse, Parent, Sibling, Riding Partner"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Mobile Number *</label>
              <input
                type="tel"
                required
                maxLength={24}
                value={form.mobileNumber}
                onChange={(e) => setForm({ ...form, mobileNumber: e.target.value })}
                placeholder="+91 98765 43210"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email (Optional)</label>
              <input
                type="email"
                maxLength={160}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="contact@example.com"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Alert Priority (1 = Highest)
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="flex flex-col justify-end gap-2 pb-1">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.notifySms}
                  onChange={(e) => setForm({ ...form, notifySms: e.target.checked })}
                />
                Include in Emergency SMS alerts
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.notifyCall}
                  onChange={(e) => setForm({ ...form, notifyCall: e.target.checked })}
                />
                Enable Quick Emergency Call button
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg cursor-pointer"
            >
              {busy ? 'Saving...' : editingId ? 'Update Contact' : 'Save Contact'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {sortedContacts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <Users className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="font-display text-base font-semibold text-slate-900">
            No emergency contacts added
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Add family members, close friends, or riding companions with priority rankings so RiderGuard can alert them immediately during an accident.
          </p>
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Primary Contact
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-medium">
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Relationship</th>
                  <th className="py-3 px-4">Mobile Number</th>
                  <th className="py-3 px-4">Channels</th>
                  <th className="py-3 px-4 text-right">Direct Emergency Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedContacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-slate-50">
                    <td className="py-3.5 px-4 font-mono-tabular font-bold text-slate-900">
                      P{contact.priority}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{contact.name}</div>
                      {contact.email && <div className="text-slate-500">{contact.email}</div>}
                    </td>
                    <td className="py-3.5 px-4 text-slate-700">{contact.relationship}</td>
                    <td className="py-3.5 px-4 font-mono-tabular text-slate-900">
                      {contact.mobileNumber}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">
                      {[contact.notifySms && 'SMS', contact.notifyCall && 'Call']
                        .filter(Boolean)
                        .join(' · ') || 'Alert only'}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={buildTelHref(contact.mobileNumber)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md whitespace-nowrap"
                        >
                          <Phone className="w-3 h-3" />
                          Call
                        </a>
                        <a
                          href={buildSmsHref(
                            contact.mobileNumber,
                            `RiderGuard safety check from ${profile?.fullName || 'Rider'}. You are listed as a priority ${contact.priority} emergency contact.`
                          )}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                        >
                          <MessageSquare className="w-3 h-3" />
                          SMS
                        </a>
                        <button
                          type="button"
                          onClick={() => openEdit(contact)}
                          className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"
                          aria-label={`Edit ${contact.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(contact)}
                          className="p-1.5 text-slate-500 hover:text-red-700 cursor-pointer"
                          aria-label={`Delete ${contact.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

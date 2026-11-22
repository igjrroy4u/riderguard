import React, { useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  Bike as BikeIcon,
  Camera,
  CheckCircle2,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { compressImageFile, generateSecureId } from '../../lib/geo';
import { DEFAULT_BIKE_URL, type Bike, type RiderProfile } from '../../types';

interface BikesViewProps {
  profile: RiderProfile | null;
  bikes: Bike[];
}

const EMPTY_FORM = {
  registrationNumber: '',
  brand: '',
  model: '',
  color: '',
  manufacturingYear: new Date().getFullYear(),
  vehiclePhotoUrl: '',
  insuranceProvider: '',
  insurancePolicyNumber: '',
  insuranceExpiry: '',
  rcNumber: '',
  ownerName: '',
  isPrimary: false,
};

export const BikesView: React.FC<BikesViewProps> = ({ profile, bikes }) => {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const openAddForm = () => {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      ownerName: profile?.fullName || '',
      isPrimary: bikes.length === 0,
    });
    setShowForm(true);
    setMessage(null);
  };

  const openEditForm = (bike: Bike) => {
    setEditingId(bike.id);
    setForm({
      registrationNumber: bike.registrationNumber,
      brand: bike.brand,
      model: bike.model,
      color: bike.color,
      manufacturingYear: bike.manufacturingYear,
      vehiclePhotoUrl: bike.vehiclePhotoUrl,
      insuranceProvider: bike.insuranceProvider,
      insurancePolicyNumber: bike.insurancePolicyNumber,
      insuranceExpiry: bike.insuranceExpiry,
      rcNumber: bike.rcNumber,
      ownerName: bike.ownerName,
      isPrimary: bike.isPrimary,
    });
    setShowForm(true);
    setMessage(null);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 360, 0.72);
      setForm((prev) => ({ ...prev, vehiclePhotoUrl: compressed }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to upload vehicle photo.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setBusy(true);
    setMessage(null);

    const bikeId = editingId || generateSecureId('bike', 20);
    const path = `bikes/${bikeId}`;

    try {
      // If setting this bike as primary, clear primary flag on other bikes
      if (form.isPrimary) {
        await Promise.all(
          bikes
            .filter((b) => b.id !== bikeId && b.isPrimary)
            .map((b) =>
              updateDoc(doc(db, 'bikes', b.id), {
                isPrimary: false,
                updatedAt: serverTimestamp(),
              })
            )
        );
      }

      if (editingId) {
        await updateDoc(doc(db, 'bikes', bikeId), {
          registrationNumber: form.registrationNumber.trim().toUpperCase().slice(0, 32),
          brand: form.brand.trim().slice(0, 60),
          model: form.model.trim().slice(0, 80),
          color: form.color.trim().slice(0, 40),
          manufacturingYear: Number(form.manufacturingYear) || new Date().getFullYear(),
          vehiclePhotoUrl: form.vehiclePhotoUrl.slice(0, 65000),
          insuranceProvider: form.insuranceProvider.trim().slice(0, 100),
          insurancePolicyNumber: form.insurancePolicyNumber.trim().slice(0, 80),
          insuranceExpiry: form.insuranceExpiry.trim().slice(0, 20),
          rcNumber: form.rcNumber.trim().slice(0, 60),
          ownerName: form.ownerName.trim().slice(0, 120),
          isPrimary: Boolean(form.isPrimary),
          updatedAt: serverTimestamp(),
        });
        setMessage('Bike details updated.');
      } else {
        await setDoc(doc(db, 'bikes', bikeId), {
          riderId: profile.uid,
          registrationNumber: form.registrationNumber.trim().toUpperCase().slice(0, 32),
          brand: form.brand.trim().slice(0, 60),
          model: form.model.trim().slice(0, 80),
          color: form.color.trim().slice(0, 40),
          manufacturingYear: Number(form.manufacturingYear) || new Date().getFullYear(),
          vehiclePhotoUrl: form.vehiclePhotoUrl.slice(0, 65000),
          insuranceProvider: form.insuranceProvider.trim().slice(0, 100),
          insurancePolicyNumber: form.insurancePolicyNumber.trim().slice(0, 80),
          insuranceExpiry: form.insuranceExpiry.trim().slice(0, 20),
          rcNumber: form.rcNumber.trim().slice(0, 60),
          ownerName: form.ownerName.trim().slice(0, 120),
          isPrimary: Boolean(form.isPrimary),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setMessage('New motorcycle registered to your garage.');
      }
      setShowForm(false);
    } catch (err) {
      handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, path);
    } finally {
      setBusy(false);
    }
  };

  const handleSetPrimary = async (bike: Bike) => {
    setBusy(true);
    try {
      await Promise.all(
        bikes.map((b) =>
          updateDoc(doc(db, 'bikes', b.id), {
            isPrimary: b.id === bike.id,
            updatedAt: serverTimestamp(),
          })
        )
      );
      setMessage(`${bike.brand} ${bike.model} set as active primary bike.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `bikes/${bike.id}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (bike: Bike) => {
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'bikes', bike.id));
      setMessage(`Removed ${bike.registrationNumber} from your registered bikes.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `bikes/${bike.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">My Bikes</h1>
          <p className="text-sm text-slate-600 mt-1">
            Register multiple motorcycles with insurance, registration certificate (RC), and owner information.
          </p>
        </div>
        <button
          type="button"
          onClick={openAddForm}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Add Bike
        </button>
      </div>

      {message && (
        <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="font-display text-base font-semibold text-slate-900">
              {editingId ? 'Edit Bike Details' : 'Register New Bike'}
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
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Bike Registration Number *
              </label>
              <input
                type="text"
                required
                maxLength={32}
                placeholder="e.g. KA-01-MJ-4821"
                value={form.registrationNumber}
                onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular uppercase focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Brand *</label>
              <input
                type="text"
                required
                maxLength={60}
                placeholder="e.g. Royal Enfield, KTM, Ducati"
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Model *</label>
              <input
                type="text"
                required
                maxLength={80}
                placeholder="e.g. Interceptor 650"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Colour</label>
              <input
                type="text"
                maxLength={40}
                placeholder="e.g. Matte Charcoal"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Manufacturing Year
              </label>
              <input
                type="number"
                min={1950}
                max={2035}
                value={form.manufacturingYear}
                onChange={(e) => setForm({ ...form, manufacturingYear: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Bike Owner Name
              </label>
              <input
                type="text"
                maxLength={120}
                value={form.ownerName}
                onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Insurance Provider
              </label>
              <input
                type="text"
                maxLength={100}
                placeholder="e.g. HDFC ERGO, ICICI Lombard"
                value={form.insuranceProvider}
                onChange={(e) => setForm({ ...form, insuranceProvider: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Insurance Policy Number
              </label>
              <input
                type="text"
                maxLength={80}
                value={form.insurancePolicyNumber}
                onChange={(e) => setForm({ ...form, insurancePolicyNumber: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Insurance Expiry Date
              </label>
              <input
                type="date"
                value={form.insuranceExpiry}
                onChange={(e) => setForm({ ...form, insuranceExpiry: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Registration Certificate (RC) Number
              </label>
              <input
                type="text"
                maxLength={60}
                value={form.rcNumber}
                onChange={(e) => setForm({ ...form, rcNumber: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="sm:col-span-2 flex flex-wrap items-end gap-4">
              <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
                <Camera className="w-4 h-4" />
                {form.vehiclePhotoUrl ? 'Change Vehicle Photo' : 'Upload Vehicle Photo'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>

              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={form.isPrimary}
                  onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })}
                  className="rounded border-slate-300"
                />
                Set as Primary Riding Bike (included in SOS alerts)
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg cursor-pointer"
            >
              {busy ? 'Saving...' : editingId ? 'Update Bike' : 'Save Bike'}
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

      {bikes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
          <BikeIcon className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="font-display text-base font-semibold text-slate-900">
            No motorcycles registered yet
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Add your motorcycle details so emergency responders and administrators can identify your vehicle, RC, and insurance immediately after an accident.
          </p>
          <button
            type="button"
            onClick={openAddForm}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Register Your First Bike
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {bikes.map((bike) => (
            <article
              key={bike.id}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col"
            >
              <div className="aspect-[16/10] bg-slate-100 border-b border-slate-200 overflow-hidden">
                <img
                  src={bike.vehiclePhotoUrl || DEFAULT_BIKE_URL}
                  alt={`${bike.brand} ${bike.model}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display text-lg font-bold text-slate-900">
                        {bike.brand} {bike.model}
                      </h3>
                      <div className="text-xs text-slate-600 font-mono-tabular mt-0.5">
                        {bike.registrationNumber} · {bike.color || 'Color N/A'} · {bike.manufacturingYear}
                      </div>
                    </div>
                    {bike.isPrimary && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 whitespace-nowrap">
                        <Star className="w-3.5 h-3.5 fill-emerald-600 text-emerald-600" />
                        Primary
                      </span>
                    )}
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 pt-3 border-t border-slate-100 text-xs">
                    <div>
                      <dt className="text-slate-500">Owner</dt>
                      <dd className="text-slate-900 font-medium">{bike.ownerName || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">RC Number</dt>
                      <dd className="text-slate-900 font-mono-tabular">{bike.rcNumber || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Insurance Provider</dt>
                      <dd className="text-slate-900">{bike.insuranceProvider || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Policy / Expiry</dt>
                      <dd className="text-slate-900 font-mono-tabular">
                        {bike.insurancePolicyNumber || '—'}
                        {bike.insuranceExpiry ? ` (${bike.insuranceExpiry})` : ''}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
                  {!bike.isPrimary && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleSetPrimary(bike)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                    >
                      Set as Primary
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openEditForm(bike)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDelete(bike)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 rounded-md cursor-pointer ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

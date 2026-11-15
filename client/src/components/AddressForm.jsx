import { useState } from 'react';
import { Button, Field } from './ui';

const EMPTY = { label: 'Home', fullName: '', phone: '', line1: '', line2: '', city: '', state: '', postalCode: '', isDefault: false };

const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

function validate(v) {
  const e = {};
  if (v.fullName.trim().length < 2) e.fullName = 'Full name is required';
  if (!/^[+]?[0-9\s-]{10,15}$/.test(v.phone.trim())) e.phone = 'Enter a valid 10-digit phone number';
  if (v.line1.trim().length < 3) e.line1 = 'Address is required';
  if (v.city.trim().length < 2) e.city = 'City is required';
  if (!v.state) e.state = 'Select a state';
  if (!/^[0-9]{6}$/.test(v.postalCode.trim())) e.postalCode = 'Enter a 6-digit PIN code';
  return e;
}

/** Shared address form; maps server-side validation errors back onto fields. */
export function AddressForm({ initial, onSubmit, onCancel, submitLabel = 'Save address' }) {
  const [values, setValues] = useState({ ...EMPTY, ...initial });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const errs = validate(values);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setFormError('');
    try {
      const { _id, ...payload } = values;
      await onSubmit(payload);
    } catch (err) {
      const fieldErrors = Object.fromEntries((err.details || []).map((d) => [d.field, d.message]));
      setErrors(fieldErrors);
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" value={values.fullName} onChange={set('fullName')} error={errors.fullName} autoComplete="name" />
      <Field label="Phone number" value={values.phone} onChange={set('phone')} error={errors.phone} autoComplete="tel" inputMode="tel" />
      <Field className="sm:col-span-2" label="Address line 1" value={values.line1} onChange={set('line1')} error={errors.line1} placeholder="House no., building, street" autoComplete="address-line1" />
      <Field className="sm:col-span-2" label="Address line 2 (optional)" value={values.line2} onChange={set('line2')} placeholder="Area, landmark" autoComplete="address-line2" />
      <Field label="City" value={values.city} onChange={set('city')} error={errors.city} autoComplete="address-level2" />
      <Field as="select" label="State" value={values.state} onChange={set('state')} error={errors.state} autoComplete="address-level1">
        <option value="">Select state</option>
        {STATES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </Field>
      <Field label="PIN code" value={values.postalCode} onChange={set('postalCode')} error={errors.postalCode} inputMode="numeric" maxLength={6} autoComplete="postal-code" />
      <Field as="select" label="Address type" value={values.label} onChange={set('label')}>
        <option>Home</option>
        <option>Work</option>
        <option>Other</option>
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-soft sm:col-span-2">
        <input type="checkbox" checked={values.isDefault} onChange={set('isDefault')} className="size-4 accent-[#6b1e2b]" /> Make this my default address
      </label>
      {formError && <p className="text-sm text-danger sm:col-span-2">{formError}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={saving}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

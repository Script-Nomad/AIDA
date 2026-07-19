import { useState, useEffect } from 'react';
import apiClient from '../services/api';

/**
 * Manages a single integer platform setting exposed under
 * `/system/settings/{key}` (GET returns `{ value }` as a string, PUT accepts
 * `{ value }`). Collapses the value/original/saving/message + load/save
 * boilerplate that was copy-pasted per setting in Settings.jsx.
 *
 * @param {string} key                 setting key (endpoint suffix)
 * @param {object} opts
 * @param {number} opts.default        fallback value if the load fails
 * @param {(v:number)=>?string} opts.validate  returns an error string, or null/undefined if valid
 * @param {string} opts.successText    message shown after a successful save
 * @param {string} opts.errorText      fallback message if the save request fails
 * @returns {{value, setValue, original, saving, message, save, dirty}}
 */
export function useSetting(key, { default: defaultValue, validate, successText, errorText }) {
  const [value, setValue] = useState(defaultValue);
  const [original, setOriginal] = useState(defaultValue);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get(`/system/settings/${key}`);
        const parsed = parseInt(data.value);
        if (!cancelled) { setValue(parsed); setOriginal(parsed); }
      } catch {
        if (!cancelled) { setValue(defaultValue); setOriginal(defaultValue); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const save = async () => {
    const err = validate ? validate(value) : null;
    if (err) {
      setMessage({ type: 'error', text: err });
      setTimeout(() => setMessage(null), 5000);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await apiClient.put(`/system/settings/${key}`, { value: value.toString() });
      setOriginal(value);
      setMessage({ type: 'success', text: successText });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.detail || errorText });
      setTimeout(() => setMessage(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  return { value, setValue, original, saving, message, save, dirty: value !== original };
}

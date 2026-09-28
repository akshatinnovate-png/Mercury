/* ================================================================
   MERCURY — sentence repair
   Fingerspelling arrives as a run of letters with no spaces and the
   occasional misread. This asks the model for the sentence that was
   meant. The key lives on the server; the page only ever talks to
   /api/llm on the same origin.

   Every failure is soft: if the model is unavailable the studio keeps
   working and falls back to a local reading.
   ================================================================ */

const KEY_STORE = 'mercury.groqKey';

export function localKey() { return localStorage.getItem(KEY_STORE) || ''; }
export function setLocalKey(k) {
  k ? localStorage.setItem(KEY_STORE, k.trim()) : localStorage.removeItem(KEY_STORE);
}

export async function llmStatus() {
  try {
    const r = await fetch('/api/health');
    const j = await r.json();
    return { configured: !!j.llm?.configured || !!localKey(), model: j.llm?.model || null };
  } catch {
    return { configured: !!localKey(), model: null };
  }
}

/**
 * @param {string} text raw recognised letters
 * @returns {Promise<{ok:boolean, text:string, reason?:string, model?:string}>}
 */
export async function repair(text, { system, context, signal } = {}) {
  const key = localKey();
  // non-manual grammar, when the face was readable, changes the reading:
  // the same letters are a statement or a question depending on the brows
  const payload = context ? `${text}\n\n[${context}]` : text;
  try {
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { 'X-Mercury-Key': key } : {})
      },
      body: JSON.stringify({ text: payload, system }),
      signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { ok: false, text: fallback(text), reason: data.reason || `http ${res.status}` };
    }
    return { ok: true, text: data.text, model: data.model, tokens: data.tokens };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, text: '', reason: 'cancelled' };
    return { ok: false, text: fallback(text), reason: 'offline' };
  }
}

/**
 * Offline reading: no model, no network. Splits the letter run on the
 * explicit spaces the signer gave and applies sentence case, so the
 * studio still produces something usable on its own.
 */
export function fallback(raw) {
  const words = raw.split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const s = words.map(w => w.toLowerCase()).join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.');
}

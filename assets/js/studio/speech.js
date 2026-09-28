/* ================================================================
   MERCURY — voice out, and voice in
   Speech synthesis gives the signed sentence a voice. Recognition,
   where the browser has it, lets a hearing person answer back — which
   is what makes this a conversation rather than a readout.
   ================================================================ */

export class Voice {
  constructor() {
    this.supported = 'speechSynthesis' in window;
    this.voices = [];
    this.voiceName = localStorage.getItem('mercury.voice') || '';
    this.rate = +(localStorage.getItem('mercury.rate') || 1);
    this.enabled = localStorage.getItem('mercury.speak') !== '0';
    if (this.supported) {
      const load = () => { this.voices = speechSynthesis.getVoices(); };
      load();
      speechSynthesis.onvoiceschanged = load;
    }
  }

  pick() {
    if (!this.voices.length) this.voices = speechSynthesis.getVoices();
    return this.voices.find(v => v.name === this.voiceName)
        || this.voices.find(v => v.lang?.startsWith('en') && v.localService)
        || this.voices.find(v => v.lang?.startsWith('en'))
        || this.voices[0];
  }

  speak(text, { force = false } = {}) {
    if (!this.supported || !text) return false;
    if (!this.enabled && !force) return false;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = this.pick();
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = this.rate;
      u.pitch = 1;
      speechSynthesis.speak(u);
      return true;
    } catch { return false; }
  }

  stop() { try { speechSynthesis.cancel(); } catch {} }

  setVoice(name) { this.voiceName = name; localStorage.setItem('mercury.voice', name); }
  setRate(r) { this.rate = r; localStorage.setItem('mercury.rate', String(r)); }
  setEnabled(on) { this.enabled = on; localStorage.setItem('mercury.speak', on ? '1' : '0'); }
}

/* --------------------------------------------------------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export class Ears {
  constructor({ onText, onState } = {}) {
    this.supported = !!SR;
    this.onText = onText || (() => {});
    this.onState = onState || (() => {});
    this.active = false;
    this.rec = null;
  }

  toggle() { this.active ? this.stop() : this.start(); }

  start() {
    if (!this.supported || this.active) return;
    this.rec = new SR();
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.rec.lang = 'en-US';
    this.rec.onresult = e => {
      let finalText = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.onText({ final: finalText.trim(), interim: interim.trim() });
    };
    this.rec.onerror = e => { this.onState('error', e.error); this.stop(); };
    this.rec.onend = () => { if (this.active) { try { this.rec.start(); } catch {} } };
    try { this.rec.start(); this.active = true; this.onState('listening'); }
    catch (e) { this.onState('error', e.message); }
  }

  stop() {
    this.active = false;
    try { this.rec?.stop(); } catch {}
    this.onState('idle');
  }
}

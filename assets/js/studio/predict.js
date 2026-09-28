/* ================================================================
   MERCURY — predictive fingerspelling
   Spelling a word letter by letter is slow. This offers completions
   after the first two or three letters, the way a phone keyboard does.

   Three sources, in order of how much they are trusted:

     yours     words you have actually spelled before, kept on this
               device. A name you sign often should surface after two
               letters, and nobody else's vocabulary should get in the
               way of that.
     core      a frequency-ordered list of common English words, so
               the feature works on the very first run.
     model     for anything longer or unusual, the language model is
               asked once the prefix is distinctive enough.

   Everything is ranked by prefix match, then by how often you have
   used it, then by word frequency. Short words win ties, because a
   short word costs less to reject than a long one.
   ================================================================ */

const STORE = 'mercury.vocab';

/* A small frequency-ordered core so the feature is useful before the
   studio has learned anything about you. */
const CORE = `the be to of and a in that have i it for not on with he as you do at
this but his by from they we say her she or an will my one all would there their
what so up out if about who get which go me when make can like time no just him
know take people into year your good some could them see other than then now look
only come its over think also back after use two how our work first well way even
new want because any these give day most us is are was were been has had did
hello please thank thanks yes name help sorry water food doctor hospital pharmacy
emergency phone address today tomorrow morning evening night week month here where
why when how much many more less open closed left right stop wait slow fast repeat
understand sign deaf hearing interpreter family mother father sister brother friend
school teacher student work home house room money price ticket train bus taxi
appointment medicine pain sick better worse hot cold tired hungry happy sad
mercury signing language alphabet letter word sentence voice hand`
  .split(/\s+/).filter(Boolean);

const CORE_RANK = new Map(CORE.map((w, i) => [w.toUpperCase(), i]));

function loadVocab() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; }
  catch { return {}; }
}
function saveVocab(v) {
  try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* full or blocked */ }
}

export class Predictor {
  constructor() {
    this.vocab = loadVocab();          // { WORD: timesUsed }
    this.pending = null;
    this.lastPrefix = '';
    this.modelSuggestions = [];
  }

  /** Record a finished sentence so its words are offered next time. */
  learn(text) {
    if (!text) return;
    let changed = false;
    for (const raw of text.toUpperCase().split(/[^A-Z']+/)) {
      if (raw.length < 2) continue;
      this.vocab[raw] = (this.vocab[raw] || 0) + 1;
      changed = true;
    }
    if (changed) saveVocab(this.vocab);
  }

  forget() { this.vocab = {}; saveVocab(this.vocab); }

  get size() { return Object.keys(this.vocab).length; }

  /**
   * Completions for the word being spelled.
   * @param prefix letters of the current word, upper case
   * @returns [{word, source, score}]
   */
  suggest(prefix, limit = 3) {
    prefix = (prefix || '').toUpperCase().replace(/[^A-Z']/g, '');
    if (prefix.length < 2) return [];

    const seen = new Set();
    const out = [];

    // 1. your own words, ordered by how often you have used them
    for (const [word, uses] of Object.entries(this.vocab)) {
      if (word.length <= prefix.length || !word.startsWith(prefix)) continue;
      seen.add(word);
      out.push({ word, source: 'yours', score: 1000 + uses * 10 - word.length });
    }

    // 2. the common core
    for (const w of CORE) {
      const W = w.toUpperCase();
      if (seen.has(W) || W.length <= prefix.length || !W.startsWith(prefix)) continue;
      seen.add(W);
      out.push({ word: W, source: 'common', score: 500 - CORE_RANK.get(W) - W.length });
    }

    // 3. whatever the model last proposed for this prefix
    for (const w of this.modelSuggestions) {
      if (seen.has(w) || !w.startsWith(prefix)) continue;
      seen.add(w);
      out.push({ word: w, source: 'model', score: 200 - w.length });
    }

    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Ask the language model for completions. Debounced and fire-and-forget:
   * the answer lands in `modelSuggestions` and shows up on a later frame,
   * so nothing waits on the network.
   */
  askModel(prefix, context = '') {
    prefix = (prefix || '').toUpperCase();
    if (prefix.length < 3 || prefix === this.lastPrefix) return;
    this.lastPrefix = prefix;
    clearTimeout(this.pending);
    this.pending = setTimeout(async () => {
      try {
        const res = await fetch('/api/llm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system: 'You complete partially fingerspelled English words. ' +
                    'Reply with up to 5 likely completions, upper case, comma separated, nothing else.',
            text: context ? `Sentence so far: "${context}". Current word starts: ${prefix}` : prefix
          })
        }).then(r => r.json());
        if (!res.ok || !res.text) return;
        this.modelSuggestions = res.text
          .toUpperCase().split(/[^A-Z']+/)
          .filter(w => w.length > prefix.length && w.startsWith(prefix))
          .slice(0, 5);
      } catch { /* the local sources are enough */ }
    }, 260);
  }
}

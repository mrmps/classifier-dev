/**
 * Confidence from a forced single-token choice measures how sure the model is
 * about which letter to emit, not whether the text belongs to any of the
 * labels. On input that is not language at all it stays pinned near the top —
 * measured 0.9921 on "asdkjfhaskdjfh" and 0.9999 on "qqqq zzzz vvvv" — so
 * reporting it invites callers to threshold on a number carrying no signal.
 *
 * When this fires we withhold the score rather than publish a confident one.
 *
 * The test is deliberately conservative, and only judges Latin-script text
 * where vowel structure is a usable proxy for "is this a word". Text
 * containing letters from any other script is always left alone: a vowel
 * heuristic would flag perfectly good Japanese, Arabic or Russian.
 */

const LATIN = /\p{Script=Latin}/u;

/** Words that read as pronounceable are word-like, however rare they are. */
function notWordLike(word: string): boolean {
  // Two letters is too little to judge: "ok", "hi", "id" are all fine.
  if (word.length <= 2) return false;

  const vowels = (word.match(/[aeiouy]/g) ?? []).length;
  if (vowels === 0) return true; // qqqq, zzzz
  if (vowels / word.length < 0.2) return true; // asdkjfhaskdjfh
  if (/(.)\1{2,}/.test(word)) return true; // aaaa, hmmmm
  if (/[bcdfghjklmnpqrstvwxz]{5,}/.test(word)) return true; // unpronounceable run

  return false;
}

export function isUnintelligible(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  const letters = trimmed.match(/\p{L}/gu) ?? [];

  // Punctuation or digits only — "....", "!!!", "42". Nothing to read.
  if (letters.length === 0) return true;

  // Another script is present, so the vowel test does not apply. Assume real.
  if (letters.some((c) => !LATIN.test(c))) return false;

  const words = trimmed.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length === 0) return true;

  // A stray nonsense token inside a real sentence is not gibberish; a majority
  // of them is. The threshold keeps mixed input on the "real language" side.
  const nonsense = words.filter(notWordLike).length;
  return nonsense / words.length >= 0.6;
}

export const UNSCORED_REASON = "input does not read as natural language";

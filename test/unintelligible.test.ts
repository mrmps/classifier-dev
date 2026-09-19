// Run with: npm test
//
// The risky direction is the false positive. Flagging real language withholds a
// score that was perfectly good, and the non-Latin cases below are the ones a
// careless edit to the vowel heuristic would break first.
import { isUnintelligible } from "../src/unintelligible";

const WITHHOLD: string[] = [
  "d41d8cd98f00b204e9800998ecf8427e",
  "deadbeef".repeat(8),
  "  0xDEADBEEF01234567  ",
  "asdkjfhaskdjfh",
  "qqqq zzzz vvvv",
  "xkcdvbnm",
  "aaaaaaa",
  "....",
  "!!!!",
  "42",
  "",
  "   ",
];

const KEEP: string[] = [
  "decaf",
  "deadbeef",
  "Failed to load d41d8cd98f00b204e9800998ecf8427e",
  "Win a free iPhone click here now",
  "the mitochondria is the powerhouse of the cell",
  "SELECT * FROM users WHERE id = 1",
  "clicking save throws a 500",
  "can I get a SOC2 report?",
  "Meeting moved to 3pm, see you there",
  "The food was incredible but the service was appalling.",
  "ok",
  "hi there",
  "emoji 🎉 party",
  // A single nonsense token inside a real sentence is not gibberish.
  "asdf please reset my password",
  // Non-Latin scripts have no Latin vowels and must never be judged by them.
  "こんにちは",
  "この商品は最高です",
  "هذا رائع جدا",
  "Это ужасно",
  "Das ist eine Katastrophe",
];

let failed = 0;
for (const text of WITHHOLD) {
  if (!isUnintelligible(text)) {
    failed++;
    console.error(`  expected withheld: ${JSON.stringify(text)}`);
  }
}
for (const text of KEEP) {
  if (isUnintelligible(text)) {
    failed++;
    console.error(`  expected scored:   ${JSON.stringify(text)}`);
  }
}

const total = WITHHOLD.length + KEEP.length;
if (failed) {
  console.error(`${failed}/${total} failed`);
  process.exit(1);
}
console.log(`unintelligible: ${total}/${total} pass`);

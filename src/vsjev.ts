/**
 * classifier.dev against the model it runs on.
 *
 * The fast tier is Jev; the smart tier is Jev plus a reasoning model re-asking
 * the answers Jev was unsure about. So the one claim this service has to earn
 * is that it beats calling Jev yourself. eval/vs_jev.py measures that, live,
 * and writes the summary imported here — the table on the site is the
 * measurement, not a transcription of it. Re-run with `npm run vs-jev`.
 */

import summary from "./vs-jev.json";

type Row = {
  acc: number;
  acc_unsure: number | null;
  acc_sure: number | null;
  agree_with_jev: number;
  disagreements: number;
  disagreements_unsure: number;
  escalated: number;
  ms_item: number;
  cost_per_1k: number;
};
type Set = { n: number; unsure: number; rows: Record<string, Row> };

export const VS_JEV = summary as { measured: string; summary: Record<string, Set> };

const SETS: { key: string; name: string; about: string }[] = [
  { key: "ag_news", name: "AG News", about: "four-way topic" },
  { key: "emotion", name: "emotion", about: "six-way, genuinely hard" },
];
// The fast tier is Jev itself, so the table shows one row for both, carrying
// the direct measurement; the fast run stays in the data and in the prose.
const RUNS: { key: string; name: string }[] = [
  { key: "jev", name: "jev alone = classifier.dev fast" },
  { key: "smart", name: "classifier.dev smart" },
];

/** An accuracy as the site prints it, so every surface rounds the same way. */
export const pct = (x: number | null | undefined) => (x == null ? "-" : `${(x * 100).toFixed(1)}%`);

/** One measured accuracy, by set and run, for prose that must quote the table rather than retype it. */
export const accuracy = (set: string, run: string) => VS_JEV.summary[set]?.rows[run]?.acc;

/** Word-wrap prose to the 78 columns the plain-text docs keep. */
function wrap(text: string, width = 78): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + w.length > width) { out.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

/**
 * Roughly two standard errors on an accuracy over n items, in points: the gap
 * a reader should not be impressed by. 400 items ≈ 4.9 points at 60% accuracy.
 */
export const noiseFloor = (n: number, acc = 0.6) => 2 * Math.sqrt((acc * (1 - acc)) / n) * 100;
const sets = () => SETS.filter((s) => VS_JEV.summary[s.key]);
const row = (set: string, run: string) => VS_JEV.summary[set]?.rows[run];

/** True when the smart tier beat Jev alone on every set measured. */
export function smartWins() {
  return sets().every((s) => (row(s.key, "smart")?.acc ?? 0) > (row(s.key, "jev")?.acc ?? 1));
}

/** The gain, in percentage points, per set — what the headline is allowed to say. */
export function smartGain() {
  return sets().map((s) => ({
    set: s.name,
    points: ((row(s.key, "smart")?.acc ?? 0) - (row(s.key, "jev")?.acc ?? 0)) * 100,
    unsurePoints: ((row(s.key, "smart")?.acc_unsure ?? 0) - (row(s.key, "jev")?.acc_unsure ?? 0)) * 100,
  }));
}

/** The plain-text table, in the house style the docs use: two-space columns, so it renders as <pre>. */
export function vsJevText(full: boolean): string {
  const ss = sets();
  const n = VS_JEV.summary[ss[0].key].n;
  const L = 33; // label column
  const W = 20; // one set = "all" (7) + "unsure(n)" (13)
  const head1 = `  ${"".padEnd(L)}${ss.map((s) => s.name.padStart(Math.ceil((W + s.name.length) / 2)).padEnd(W)).join("")}`.trimEnd();
  const head2 = `  ${"".padEnd(L)}${ss.map((s) => "all".padStart(7) + `unsure(${VS_JEV.summary[s.key].unsure})`.padStart(13)).join("")}`;
  const rule = `  ${"-".repeat(L + ss.length * W)}`;
  const lines = RUNS.filter((r) => ss.every((s) => row(s.key, r.key))).map(
    (r) => `  ${r.name.padEnd(L)}${ss.map((s) => pct(row(s.key, r.key)!.acc).padStart(7) + pct(row(s.key, r.key)!.acc_unsure).padStart(13)).join("")}`,
  );
  const fastAcc = ss.map((s) => `${pct(row(s.key, "fast")?.acc)} vs ${pct(row(s.key, "jev")?.acc)}`).join(", ");
  const dis = ss.map((s) => row(s.key, "fast")).filter(Boolean) as Row[];
  const disN = dis.reduce((n, r) => n + r.disagreements, 0);
  const disU = dis.reduce((n, r) => n + r.disagreements_unsure, 0);
  const disagree = disN === 0
    ? "answered identically on every item"
    : `${disU === disN ? "every one" : `${disU}`} of its ${disN} disagreements with Jev alone was on an item one side had already put under 0.7 confidence`;
  const escalated = ss.map((s) => `${row(s.key, "smart")?.escalated ?? "-"}`).join(" / ") + ` of ${n}`;
  const floor = noiseFloor(n).toFixed(0);
  const ms = ss.map((s) => `${Math.round(row(s.key, "smart")?.ms_item ?? 0)}`).join(" / ");
  const jevCost = ss.map((s) => `$${(row(s.key, "jev")?.cost_per_1k ?? 0).toFixed(3)}`).join(" / ");

  const intro = full
    ? wrap(
        "The fast tier is Jev, TypeSafe's decision model. The smart tier is Jev plus a " +
          "reasoning model re-asking only the answers Jev put under 0.7 confidence. So the " +
          "question this service has to answer is whether it beats calling Jev " +
          `yourself. Two public test sets, ${n} items each, measured live ` +
          `over the public API with no key on ${VS_JEV.measured}. "unsure" is accuracy on just ` +
          "the items Jev was unsure about — the only ones the smart tier touches.",
      )
    : wrap(
        "The model behind this service is Jev; the smart tier re-asks what Jev was unsure " +
          `about. Same public test sets, ${n} items each, measured live on ${VS_JEV.measured}:`,
      );
  const after = full
    ? [
        ...wrap(
          "The fast tier is Jev, packed a thousand to a request, so the table shows one row for " +
            `both. Measured separately it scored the same within noise (fast ${fastAcc}), and ${disagree}. The smart tier re-asked ` +
            `${escalated} items and took about ${ms} ms per item amortised. Calling Jev ` +
            `yourself costs about ${jevCost} per thousand and needs a TypeSafe key; this ` +
            "service costs nothing and needs none.",
        ),
        "",
        ...wrap(
          `Read it with the noise in mind: on ${n} items, a gap under about ${floor} points ` +
            "overall is not evidence, and the unsure columns rest on fewer items still. " +
            "Re-run: npm run vs-jev (eval/vs_jev.py).",
        ),
      ]
    : wrap(
        `The fast tier is Jev, so one row serves both. Smart re-asked ${escalated} items. Gaps under about ` +
          `${floor} points are noise. The full table, with latency and cost, is at https://classifier.dev/benchmark`,
      );
  return [...intro, "", head1, head2, rule, ...lines, "", ...after].map((l) => (l ? `  ${l}` : l)).join("\n");
}

/**
 * The same table as HTML, for the home page. Each set's rule stops at its own
 * edge, the better number in each column is marked, and a last row carries the
 * smart tier's gain over Jev alone, signed and coloured, bold only where it
 * clears the noise on that column's items.
 */
export function vsJevHtml(): string {
  const ss = sets();
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const th = (t: string, extra = "") => `<th${extra}>${esc(t)}</th>`;
  const head1 = `<tr>${th("")}${ss.map((s) => `<th colspan="2" class="set"><span>${esc(s.name)}</span></th>`).join("")}</tr>`;
  const head2 = `<tr>${th("")}${ss.map((s) => th("all", ' class="num gap"') + th(`unsure (${VS_JEV.summary[s.key].unsure})`, ' class="num"')).join("")}</tr>`;
  const runs = RUNS.filter((r) => ss.every((s) => row(s.key, r.key)));
  // The best number in a column is green; a tie marks every holder.
  const best = (set: string, field: "acc" | "acc_unsure") =>
    Math.max(...runs.map((r) => row(set, r.key)![field] ?? -1));
  const cell = (v: number | null, set: string, field: "acc" | "acc_unsure", extra: string) =>
    `<td class="num${extra}${v != null && v === best(set, field) ? " best" : ""}">${pct(v)}</td>`;
  const body = runs
    .map((r) => {
      const cells = ss
        .map((s) => {
          const me = row(s.key, r.key)!;
          return cell(me.acc, s.key, "acc", " gap") + cell(me.acc_unsure, s.key, "acc_unsure", "");
        })
        .join("");
      // "jev alone = classifier.dev fast": the baseline is what the eye should catch; the equivalence is a note.
      const [name, alias] = r.name.split(" = ");
      const label = alias ? `${esc(name)}<span class="eq"> = ${esc(alias)}</span>` : esc(r.name);
      return `<tr${r.key === "smart" ? ' class="smart"' : ""}><th scope="row">${label}</th>${cells}</tr>`;
    })
    .join("");
  // The gain in points: green or red by sign, bold when it is more than about two standard errors on that column's items.
  const gain = (a: number | null, b: number | null, n: number, extra: string) => {
    if (a == null || b == null) return `<td class="num${extra}">-</td>`;
    const d = (a - b) * 100;
    const sign = d === 0 ? "" : d > 0 ? " win" : " loss";
    const clear = Math.abs(d) <= noiseFloor(n, b) ? "" : " clear";
    return `<td class="num${extra}${sign}${clear}">${d >= 0 ? "+" : "\u2212"}${Math.abs(d).toFixed(1)}</td>`;
  };
  const gains = runs.some((r) => r.key === "smart")
    ? `<tr class="gain"><th scope="row">smart over jev alone, points</th>${ss
        .map((s) => {
          const me = row(s.key, "smart")!;
          const jev = row(s.key, "jev")!;
          const set = VS_JEV.summary[s.key];
          return gain(me.acc, jev.acc, set.n, " gap") + gain(me.acc_unsure, jev.acc_unsure, set.unsure, "");
        })
        .join("")}</tr>`
    : "";
  // Six numeric columns do not fit a phone; the table scrolls inside the page, as the others do.
  return `<div class="scroll"><table class="vs"><thead>${head1}${head2}</thead><tbody>${body}${gains}</tbody></table></div>`;
}

/**
 * Line solver: work out an item line's true numbers from whatever OCR read.
 *
 * Every number on an item row is tied to the same before-tax value T:
 *     rate × qty = T         rate incl. tax × qty = T × (1 + GST)
 *     amount = T (or T × (1 + GST) on bills whose amount includes tax)
 *     CGST = SGST = T × GST / 2       line total = T × (1 + GST)
 * So each number "votes" for a T under every role it could have. The T (and GST rate,
 * and quantity) that the most numbers agree on wins. Numbers that don't agree were
 * misread: they are replaced from the agreeing ones, and the change is reported.
 *
 * Column headings only give each number a *preferred* role, because on phone photos
 * headings are often unreadable or the columns drift.
 */
import { GST_SLABS, formatINR, round2 } from "./numbers";

export type ValueRole = "rate" | "rateIncl" | "amount" | "taxable" | "tax" | "igst" | "total";

export interface ValueObs {
  value: number;
  alts: number[];
  /** 1 = cleanly printed, lower = guesswork in the reading. */
  quality: number;
  /** Role from the column heading above it, if known. */
  role: ValueRole | null;
  text: string;
  /** Position among the row's numbers (0 = leftmost) and how many there are. */
  order?: number;
  count?: number;
}

export interface PercentObs {
  value: number;
  text: string;
}

export interface LineObs {
  qty: number | null;
  values: ValueObs[];
  percents: PercentObs[];
}

export interface LineSolution {
  quantity: number | null;
  rateExclTax: number | null;
  rateInclTax: number | null;
  gstRate: number | null;
  amount: number | null;
  amountIncludesTax: boolean | null;
  taxableValue: number | null;
  /** Printed numbers that agree with the solution. */
  support: number;
  /** The GST rate is backed by numbers on this line (not assumed). */
  gstFromLine: boolean;
  /** T was estimated from a tax amount or a total (paise may be off). */
  estimated: boolean;
  autoFixed: string[];
  flags: string[];
  /** Internal field names that may be wrong. */
  uncertain: string[];
}

/** Concrete meaning of a number inside a hypothesis. */
type Meaning = "rate" | "rateIncl" | "amountPre" | "amountIncl" | "taxable" | "total" | "tax" | "igst";

const PRE: Meaning[] = ["rate", "amountPre", "taxable"];
const INCL: Meaning[] = ["rateIncl", "amountIncl", "total"];

/** Which meanings a heading role allows (the rest get a lower weight). */
const ROLE_MEANINGS: Record<ValueRole, Meaning[]> = {
  rate: ["rate"],
  rateIncl: ["rateIncl"],
  amount: ["amountPre", "amountIncl"],
  taxable: ["taxable"],
  tax: ["tax"],
  igst: ["igst"],
  total: ["total", "amountIncl"],
};

const ALL_MEANINGS: Meaning[] = ["amountPre", "rate", "rateIncl", "amountIncl", "taxable", "total", "tax", "igst"];

/** When nothing else decides, prefer the more common readings. */
const MEANING_ORDER: Record<Meaning, number> = {
  amountPre: 0, rate: 1, rateIncl: 2, taxable: 3, amountIncl: 4, total: 5, tax: 6, igst: 7,
};

interface Point {
  obs: number;
  meaning: Meaning;
  reading: number;
  /** Value mapped to before-tax T (or to U = T incl. tax, in the no-GST hypothesis). */
  t: number;
  tol: number;
  weight: number;
  space: "pre" | "incl" | "tax";
}

interface Hypothesis {
  q: number | null;
  qPenalty: number;
  qNote: string | null;
  g: number | null;
  /** In the no-GST hypothesis: "pre" or "incl" space. */
  space: "pre" | "incl" | "both";
  members: Point[];
  center: number;
  score: number;
  percentAgree: number;
}

function meaningPrior(obs: ValueObs, m: Meaning): number {
  if (obs.role !== null) return ROLE_MEANINGS[obs.role].includes(m) ? 1 : 0.55;
  // No heading: on every bill layout rates come before amounts, and the last number is
  // an amount or total. Only breaks ties; arithmetic still decides.
  const count = obs.count ?? 1;
  const order = obs.order ?? 0;
  const amountLike = m === "amountPre" || m === "amountIncl" || m === "total";
  const rateLike = m === "rate" || m === "rateIncl";
  if (count >= 2 && order === count - 1) return amountLike ? 0.95 : rateLike ? 0.85 : 0.9;
  if (count >= 2 && order === 0) return rateLike ? 0.95 : amountLike ? 0.85 : 0.9;
  return 0.9;
}

function readings(obs: ValueObs): { v: number; quality: number }[] {
  // Other readings ("1220000" as ₹12,20,000 instead of 12,200.00) are long shots: bills print paise.
  return [{ v: obs.value, quality: obs.quality }, ...obs.alts.map((v) => ({ v, quality: obs.quality * 0.5 }))].filter(
    (r) => r.v > 0 && Number.isFinite(r.v)
  );
}

function buildPoints(obsList: ValueObs[], q: number | null, g: number | null): Point[] {
  const pts: Point[] = [];
  const f = g === null ? 1 : 1 + g / 100;
  obsList.forEach((obs, i) => {
    for (const { v, quality } of readings(obs)) {
      for (const m of ALL_MEANINGS) {
        const weight = quality * meaningPrior(obs, m);
        const isRate = m === "rate" || m === "rateIncl";
        if (isRate && (q === null || q <= 0)) continue;
        let t: number;
        // Rates are rounded to paise, so qty × rate can be off by ½ paisa per piece.
        let tol = 0.06 + (isRate ? 0.0051 * (q ?? 1) : 0);
        let space: Point["space"];
        switch (m) {
          case "amountPre":
          case "taxable":
            t = v;
            space = "pre";
            break;
          case "rate":
            t = v * (q as number);
            space = "pre";
            break;
          case "rateIncl":
            t = (v * (q as number)) / f;
            space = "incl";
            break;
          case "amountIncl":
          case "total":
            t = v / f;
            space = "incl";
            break;
          case "tax":
            if (g === null || g === 0) continue;
            t = (v * 200) / g;
            tol = (0.006 * 200) / g + 0.02;
            space = "tax";
            break;
          case "igst":
            if (g === null || g === 0) continue;
            t = (v * 100) / g;
            tol = (0.006 * 100) / g + 0.02;
            space = "tax";
            break;
        }
        pts.push({ obs: i, meaning: m, reading: v, t, tol, weight, space });
      }
    }
  });
  return pts;
}

/** Biggest group of points (one per printed number) that agree on T. */
function bestCluster(pts: Point[], allowSpaces: (p: Point) => boolean): { members: Point[]; center: number; weight: number } | null {
  const usable = pts.filter(allowSpaces);
  let best: { members: Point[]; center: number; weight: number } | null = null;
  for (const seed of usable) {
    const byObs = new Map<number, Point>();
    for (const p of usable) {
      if (Math.abs(p.t - seed.t) > p.tol + seed.tol) continue;
      const cur = byObs.get(p.obs);
      if (!cur || p.weight > cur.weight || (p.weight === cur.weight && MEANING_ORDER[p.meaning] < MEANING_ORDER[cur.meaning])) {
        byObs.set(p.obs, p);
      }
    }
    const members = Array.from(byObs.values());
    const weight = members.reduce((s, p) => s + p.weight, 0);
    const order = members.reduce((s, p) => s + MEANING_ORDER[p.meaning], 0);
    const bestOrder = best ? best.members.reduce((s, p) => s + MEANING_ORDER[p.meaning], 0) : Infinity;
    if (!best || weight > best.weight + 1e-9 || (Math.abs(weight - best.weight) <= 1e-9 && order < bestOrder)) {
      best = { members, center: seed.t, weight };
    }
  }
  return best;
}

function percentAgreement(percents: PercentObs[], g: number): number {
  let s = 0;
  for (const p of percents) {
    if (Math.abs(p.value - g) < 0.01) s += 0.5;
    else if (g > 0 && Math.abs(p.value * 2 - g) < 0.01) s += 0.5; // CGST / SGST rate
  }
  return s;
}

function qtyCandidates(obs: LineObs): { q: number | null; penalty: number; note: string | null }[] {
  const out: { q: number | null; penalty: number; note: string | null }[] = [];
  const q = obs.qty;
  if (q !== null && q > 0) {
    out.push({ q, penalty: 0, note: null });
    // Tally prints "2.00 PCS"; a lost decimal point gives "200". Cheap to try.
    if (q >= 100 && q % 100 === 0) out.push({ q: q / 100, penalty: 0.15, note: `quantity ${q} → ${q / 100} (decimal point missed)` });
    if (q >= 10 && q % 10 === 0) out.push({ q: q / 10, penalty: 0.5, note: `quantity ${q} → ${q / 10} (decimal point missed)` });
  }
  // Quantity from amount ÷ rate, when both are on the row (covers an unread quantity).
  const vals = obs.values.flatMap((o) => readings(o).map((r) => r.v));
  for (const a of vals)
    for (const r of vals) {
      if (r <= 0 || a <= r) continue;
      const k = a / r;
      const n = Math.round(k);
      if (n >= 1 && n <= 500 && Math.abs(k - n) * r <= 0.01 * n + 0.05 && !out.some((c) => c.q === n)) {
        out.push({ q: n, penalty: q === null ? 0.3 : 0.7, note: q === null ? `quantity from amount ÷ rate = ${n}` : `quantity ${q} → ${n} (amount ÷ rate)` });
      }
    }
  if (out.length === 0) out.push({ q: null, penalty: 0, note: null });
  return out;
}

const FIELD_LABEL: Record<Meaning, string> = {
  rate: "rate",
  rateIncl: "rate incl. tax",
  amountPre: "amount",
  amountIncl: "amount",
  taxable: "taxable value",
  total: "line total",
  tax: "tax",
  igst: "IGST",
};

export function solveLine(obs: LineObs): LineSolution {
  const hyps: Hypothesis[] = [];
  for (const qc of qtyCandidates(obs)) {
    // No GST rate known: numbers can only agree within the same space.
    const ptsNoG = buildPoints(obs.values, qc.q, null);
    for (const space of ["pre", "incl"] as const) {
      const c = bestCluster(ptsNoG, (p) => p.space === space);
      if (c) hyps.push({ q: qc.q, qPenalty: qc.penalty, qNote: qc.note, g: null, space, members: c.members, center: c.center, score: c.weight - qc.penalty, percentAgree: 0 });
    }
    // A GST rate counts only if the numbers on the line prove it (before- and after-tax
    // numbers agree through it, or a printed tax % matches).
    for (const g of GST_SLABS) {
      const pts = buildPoints(obs.values, qc.q, g);
      const c = bestCluster(pts, () => true);
      if (!c) continue;
      const spaces = new Set(c.members.map((p) => p.space));
      const pa = percentAgreement(obs.percents, g);
      const pinned = spaces.has("tax") || (spaces.has("pre") && spaces.has("incl")) || pa > 0;
      if (!pinned) continue;
      hyps.push({ q: qc.q, qPenalty: qc.penalty, qNote: qc.note, g, space: "both", members: c.members, center: c.center, score: c.weight + pa - qc.penalty, percentAgree: pa });
    }
  }

  const rank = (h: Hypothesis) => [h.score, h.g === null ? 1 : 0, h.g === 18 ? 1 : 0, h.space === "pre" ? 1 : 0];
  hyps.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (Math.abs(ra[i] - rb[i]) > 1e-9) return rb[i] - ra[i];
    return 0;
  });
  // A no-GST hypothesis only wins a tie; a GST rate that more numbers agree on wins outright.
  const best = hyps[0];
  return finish(obs, best ?? null);
}

function finish(obs: LineObs, h: Hypothesis | null): LineSolution {
  const autoFixed: string[] = [];
  const flags: string[] = [];
  const uncertain = new Set<string>();
  const sol: LineSolution = {
    quantity: obs.qty,
    rateExclTax: null,
    rateInclTax: null,
    gstRate: null,
    amount: null,
    amountIncludesTax: null,
    taxableValue: null,
    support: 0,
    gstFromLine: false,
    estimated: false,
    autoFixed,
    flags,
    uncertain: [],
  };
  if (!h || h.members.length === 0) {
    if (obs.values.length === 0) flags.push("No price or amount read");
    else flags.push("Numbers on this line don't agree — please check");
    uncertain.add("rate").add("amount");
    if (obs.qty === null) uncertain.add("quantity");
    sol.uncertain = Array.from(uncertain);
    return sol;
  }

  const q = h.q;
  const g = h.g;
  const f = g === null ? null : 1 + g / 100;
  if (h.qNote) autoFixed.push(h.qNote);
  sol.quantity = q;
  sol.gstRate = g;
  sol.gstFromLine = g !== null;
  sol.support = h.members.length;

  const member = (m: Meaning) => h.members.find((p) => p.meaning === m);
  const exact = (p: Point | undefined) => (p && obs.values[p.obs].quality >= 0.8 ? p : undefined);

  // Choose the most trustworthy printed number to build the rest from.
  let T: number | null = null;
  let U: number | null = null;
  let r: number | null = null;
  let ri: number | null = null;
  const pre = exact(member("amountPre")) ?? exact(member("taxable"));
  const rateP = member("rate");
  const rateInclP = member("rateIncl");
  const rateIsGood = rateP && obs.values[rateP.obs].quality >= 0.8;
  const rateInclIsGood = rateInclP && obs.values[rateInclP.obs].quality >= 0.8;
  const qq = q ?? 0;

  if (pre) {
    T = pre.reading;
    if (rateP && qq > 0 && Math.abs(rateP.reading * qq - T) <= 0.01 * qq + 0.05) r = rateP.reading;
    else if (qq > 0) r = round2(T / qq);
  } else if (rateInclP && f !== null && qq > 0 && (rateInclIsGood || !rateIsGood)) {
    ri = rateInclP.reading;
    r = round2(ri / f);
    T = round2((qq * ri) / f);
  } else if (rateP && qq > 0) {
    r = rateP.reading;
    T = round2(qq * r);
  } else if (member("amountPre") ?? member("taxable")) {
    T = (member("amountPre") ?? member("taxable"))!.reading;
    if (qq > 0) r = round2(T / qq);
  } else if (rateInclP && qq > 0) {
    // No GST rate: only the tax-inclusive side is known.
    ri = rateInclP.reading;
    U = round2(qq * ri);
  } else if (member("amountIncl") ?? member("total")) {
    const p = (member("amountIncl") ?? member("total"))!;
    if (f !== null) {
      T = round2(p.reading / f);
      sol.estimated = true;
      if (qq > 0) r = round2(T / qq);
    } else {
      U = p.reading;
      if (qq > 0) ri = round2(U / qq);
    }
  } else if (member("tax") ?? member("igst")) {
    const p = (member("tax") ?? member("igst"))!;
    T = round2(p.t);
    sol.estimated = true;
    if (qq > 0) r = round2(T / qq);
  }

  if (ri === null && rateInclP && (f === null || Math.abs(rateInclP.reading - (r ?? 0) * f) <= 0.05 + rateInclP.reading * 0.0002)) ri = rateInclP.reading;
  if (ri === null && r !== null && f !== null) ri = round2(r * f);
  if (U === null && T !== null && f !== null) U = round2(T * f);

  // The Amount column: before tax unless the matching number was the tax-inclusive one.
  const underAmountHeading = h.members.find((p) => obs.values[p.obs].role === "amount" && (p.meaning === "amountPre" || p.meaning === "amountIncl"));
  const hasTaxColumns = Boolean(member("tax") || member("igst"));
  const amountP = underAmountHeading ?? member("amountPre") ?? (hasTaxColumns ? undefined : member("amountIncl"));
  if (amountP) {
    sol.amount = amountP.meaning === "amountPre" ? T ?? amountP.reading : amountP.reading;
    sol.amountIncludesTax = amountP.meaning === "amountIncl";
    if (amountP.meaning === "amountIncl" && U !== null && Math.abs(U - amountP.reading) > 1) sol.amount = U;
  } else if ((member("tax") || member("igst") || member("total")) && T !== null) {
    // Bills with tax and total columns per line (Ahujas / LG): "Amount" is before tax.
    sol.amount = T;
    sol.amountIncludesTax = false;
  } else if (member("taxable") && U !== null) {
    // "Taxable | GST % | Amount" layout: the amount includes tax.
    sol.amount = U;
    sol.amountIncludesTax = true;
  } else {
    sol.amount = T ?? U;
    sol.amountIncludesTax = T !== null ? false : U !== null ? true : null;
  }
  sol.rateExclTax = r;
  sol.rateInclTax = ri;
  sol.taxableValue = T;

  // Report numbers that were misread (they had a heading role but didn't agree).
  const inCluster = new Set(h.members.map((p) => p.obs));
  obs.values.forEach((o, i) => {
    if (inCluster.has(i) || o.role === null) return;
    const fixedTo =
      o.role === "rate" ? r : o.role === "rateIncl" ? ri : o.role === "amount" ? sol.amount : o.role === "taxable" ? T : o.role === "total" ? U : null;
    if (fixedTo === null) return;
    const label = o.role === "amount" ? "amount" : FIELD_LABEL[o.role as Meaning] ?? o.role;
    autoFixed.push(`${label} ${formatINR(o.value)} → ${formatINR(fixedTo)} (${fixReason(o.role, h)})`);
  });
  // A tax % that disagrees with the line's numbers was misread ("8%" for "18%").
  if (g !== null && h.members.some((p) => p.space !== "tax")) {
    for (const p of obs.percents) {
      const agrees = Math.abs(p.value - g) < 0.01 || Math.abs(p.value * 2 - g) < 0.01;
      if (!agrees && p.value > 0) autoFixed.push(`GST ${p.value}% → ${g}% (amount ÷ taxable)`);
    }
  }

  // How sure are we?
  const otherNumbers = obs.values.length - h.members.length;
  if (h.members.length === 1) {
    if (otherNumbers > 0) flags.push("Numbers on this line don't agree — please check");
    else flags.push("Only one number could be read on this line — please check");
    uncertain.add("rate").add("amount");
    if (ri !== null) uncertain.add("rateIncl");
  }
  // Two independent numbers (e.g. CGST and line total) agreeing pins T to the paisa.
  if (sol.estimated && h.members.length >= 2) sol.estimated = false;
  if (sol.estimated) {
    flags.push("Amount worked out from the tax/total (paise may differ) — please check");
    uncertain.add("amount").add("rate");
  }
  if (q === null) {
    flags.push("Quantity not read");
    uncertain.add("quantity");
  }
  sol.uncertain = Array.from(uncertain);
  return sol;
}

function fixReason(role: ValueRole, h: Hypothesis): string {
  const has = (m: Meaning) => h.members.some((p) => p.meaning === m);
  if (role === "rate") return has("amountPre") || has("taxable") ? "amount ÷ qty" : has("rateIncl") ? "rate incl. tax ÷ GST" : "other numbers on the line";
  if (role === "amount") return has("taxable") ? `taxable + ${h.g ?? 0}% GST` : has("rate") ? "qty × rate" : "other numbers on the line";
  if (role === "rateIncl") return `rate + ${h.g ?? 0}% GST`;
  if (role === "taxable") return "qty × rate";
  return "other numbers on the line";
}

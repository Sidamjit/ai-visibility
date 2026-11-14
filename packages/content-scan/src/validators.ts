/**
 * Check-digit validators for identifiers. Validation is what turns "a number
 * that looks like an IRD number" into "an IRD number" and keeps false
 * positives (invoice numbers, phone numbers, dates) out of findings.
 *
 * Sources:
 *  - IRD number: Inland Revenue "IRD number validation" (payroll/PAYE spec), 2019 revision.
 *  - NZ bank account: Inland Revenue bank-account modulus algorithms A–G, X.
 *  - NHI: HISO 10046 (legacy mod 11, expanded mod 23).
 *  - AU TFN: ATO weighted modulus 11.
 *  - Payment cards: ISO/IEC 7812 Luhn.
 */

const digitsOf = (s: string) => s.replace(/\D/g, '');

/** Luhn (mod 10) check used by payment cards. */
export function luhnValid(input: string): boolean {
  const d = digitsOf(input);
  if (d.length < 12 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Card brand prefixes (IIN ranges) — avoids flagging random Luhn-valid numbers. */
export function looksLikeCardNumber(input: string): boolean {
  const d = digitsOf(input);
  return (
    /^4\d{12}(\d{3}){0,2}$/.test(d) || // Visa
    /^(5[1-5]\d{14}|2(2[2-9]|[3-6]\d|7[01])\d{12}|2720\d{12})$/.test(d) || // Mastercard
    /^3[47]\d{13}$/.test(d) || // Amex
    /^6(011|5\d\d)\d{12,15}$/.test(d) || // Discover
    /^35(2[89]|[3-8]\d)\d{12,15}$/.test(d) || // JCB
    /^3(0[0-5]|[68]\d)\d{11,16}$/.test(d) // Diners
  );
}

/** NZ IRD number (8 or 9 digits, range 10,000,000–150,000,000, mod 11 with secondary weights). */
export function nzIrdValid(input: string): boolean {
  const d = digitsOf(input);
  if (d.length < 8 || d.length > 9) return false;
  const n = Number(d);
  if (n < 10_000_000 || n > 150_000_000) return false;
  const base = d.slice(0, -1).padStart(8, '0');
  const check = Number(d[d.length - 1]);
  const calc = (weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + w * Number(base[i]), 0);
    const rem = sum % 11;
    return rem === 0 ? 0 : 11 - rem;
  };
  let expected = calc([3, 2, 7, 6, 5, 4, 3, 2]);
  if (expected === 10) {
    expected = calc([7, 4, 3, 2, 5, 2, 7, 6]);
    if (expected === 10) return false;
  }
  return expected === check;
}

type BankAlgo = { weights: number[]; modulo: number; fold: boolean };
const BANK_ALGOS: Record<string, BankAlgo> = {
  A: { weights: [0, 0, 6, 3, 7, 9, 0, 0, 10, 5, 8, 4, 2, 1, 0, 0, 0, 0], modulo: 11, fold: false },
  B: { weights: [0, 0, 0, 0, 0, 0, 0, 0, 10, 5, 8, 4, 2, 1, 0, 0, 0, 0], modulo: 11, fold: false },
  D: { weights: [0, 0, 0, 0, 0, 0, 0, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0], modulo: 11, fold: false },
  E: { weights: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 4, 3, 2, 0, 0, 0, 1], modulo: 11, fold: true },
  F: { weights: [0, 0, 0, 0, 0, 0, 0, 1, 7, 3, 1, 7, 3, 1, 0, 0, 0, 0], modulo: 10, fold: false },
  G: { weights: [0, 0, 0, 0, 0, 0, 0, 1, 3, 7, 1, 3, 7, 1, 0, 3, 7, 1], modulo: 10, fold: true },
};
/** Bank ids currently or historically issued in NZ. */
const NZ_BANK_IDS = new Set([
  1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
  29, 30, 31, 33, 35, 38,
]);

/**
 * NZ bank account number: bank (2) - branch (4) - account (7-8) - suffix (2-4).
 * Accepts separated parts; returns false for unknown banks or failed modulus.
 */
export function nzBankAccountValid(
  bank: string,
  branch: string,
  account: string,
  suffix: string,
): boolean {
  const bankN = Number(bank);
  if (!NZ_BANK_IDS.has(bankN)) return false;
  if (bankN === 31) return true; // Algorithm X: no check digit.
  const acct = account.padStart(8, '0');
  const digits = (bank.padStart(2, '0') + branch.padStart(4, '0') + acct + suffix.padStart(4, '0'))
    .split('')
    .map(Number);
  if (digits.length !== 18) return false;
  let algo: BankAlgo;
  if (bankN === 8) algo = BANK_ALGOS.D!;
  else if (bankN === 9) algo = BANK_ALGOS.E!;
  else if (bankN === 25 || bankN === 33) algo = BANK_ALGOS.F!;
  else if (bankN === 26 || bankN === 28 || bankN === 29) algo = BANK_ALGOS.G!;
  else algo = Number(acct) < 990_000 ? BANK_ALGOS.A! : BANK_ALGOS.B!;
  let sum = 0;
  for (let i = 0; i < 18; i++) {
    let p = digits[i]! * algo.weights[i]!;
    if (algo.fold) while (p > 9) p = Math.floor(p / 10) + (p % 10);
    sum += p;
  }
  return sum % algo.modulo === 0;
}

const NHI_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O; A=1 ... Z=24
const nhiValue = (c: string) => (/\d/.test(c) ? Number(c) : NHI_ALPHABET.indexOf(c) + 1);

/** NZ National Health Index number, legacy AAANNNC (mod 11) or expanded AAANNAX (mod 23). */
export function nzNhiValid(input: string): boolean {
  const s = input.toUpperCase().replace(/\s/g, '');
  const legacy = /^[A-HJ-NP-Z]{3}\d{4}$/.test(s);
  const expanded = /^[A-HJ-NP-Z]{3}\d{2}[A-HJ-NP-Z]{2}$/.test(s);
  if (!legacy && !expanded) return false;
  const sum = [7, 6, 5, 4, 3, 2].reduce((acc, w, i) => acc + w * nhiValue(s[i]!), 0);
  if (legacy) {
    const rem = sum % 11;
    if (rem === 0) return false;
    const check = (11 - rem) % 10;
    return check === Number(s[6]);
  }
  const check = 23 - (sum % 23);
  return NHI_ALPHABET[check - 1] === s[6];
}

/** Australian Tax File Number (8 or 9 digits, weighted mod 11). */
export function auTfnValid(input: string): boolean {
  const d = digitsOf(input);
  const weights =
    d.length === 9
      ? [1, 4, 3, 7, 5, 8, 6, 9, 10]
      : d.length === 8
        ? [10, 7, 8, 4, 6, 3, 5, 1]
        : null;
  if (!weights || /^0+$/.test(d)) return false;
  const sum = weights.reduce((acc, w, i) => acc + w * Number(d[i]), 0);
  return sum % 11 === 0;
}

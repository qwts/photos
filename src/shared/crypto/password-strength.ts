// Password strength for the recovery-key dialog (#240) — the mock's own
// heuristic, verbatim: coarse tiers to steer users toward long, mixed
// passwords. Deliberately NOT a crack-time estimator; the export button
// additionally gates on score >= 3.

export interface PasswordStrength {
  /** 0–5 filled meter segments. */
  readonly score: number;
  readonly label: '' | 'Weak' | 'Fair' | 'Strong' | 'Very strong';
  readonly tone: 'neutral' | 'red' | 'amber' | 'green';
}

export function strengthOf(password: string): PasswordStrength {
  if (password === '') {
    return { score: 0, label: '', tone: 'neutral' };
  }
  let score = 0;
  if (password.length >= 8) {
    score += 1;
  }
  if (password.length >= 14) {
    score += 1;
  }
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) {
    score += 1;
  }
  if (/\d/.test(password)) {
    score += 1;
  }
  if (/[^A-Za-z0-9]/.test(password)) {
    score += 1;
  }
  if (score <= 2) {
    return { score, label: 'Weak', tone: 'red' };
  }
  if (score === 3) {
    return { score, label: 'Fair', tone: 'amber' };
  }
  if (score === 4) {
    return { score, label: 'Strong', tone: 'green' };
  }
  return { score: 5, label: 'Very strong', tone: 'green' };
}

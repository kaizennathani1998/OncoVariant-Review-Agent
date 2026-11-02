export type VafParseResult =
  | { ok: true; fraction: number }
  | { ok: false; error: string };

/**
 * Parses a user-submitted VAF ("0.42", "42%", 0.42, 42) into a 0-1 fraction. This is the
 * single source of truth for VAF-dependent rules (clinical-impact thresholds, origin
 * caveats). It is intentionally never read by the germline or oncogenicity scoring
 * engines — VAF must never change an ACMG/AMP or CGC-VICC score, only surface as context
 * or a warning elsewhere.
 */
export function parseVaf(input: string | number | undefined): VafParseResult {
  if (input === undefined || input === null || input === "") {
    return { ok: false, error: "No VAF was submitted." };
  }
  let fraction: number;
  if (typeof input === "number") {
    fraction = input;
  } else {
    const trimmed = input.trim();
    if (trimmed.endsWith("%")) {
      const percent = Number(trimmed.slice(0, -1));
      if (!Number.isFinite(percent)) return { ok: false, error: `"${input}" is not a valid percentage.` };
      fraction = percent / 100;
    } else {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) return { ok: false, error: `"${input}" is not a valid number.` };
      fraction = parsed;
    }
  }
  if (fraction < 0 || fraction > 1) {
    return { ok: false, error: `VAF ${fraction} is out of the valid 0-1 fraction range.` };
  }
  return { ok: true, fraction };
}

import type { CriterionOutcome } from "./types";

export type OncogenicityValidationResult = {
  valid: boolean;
  validationErrors: string[];
};

/**
 * Explicit incompatibility matrix (ClinGen-CGC-VICC framework). Each entry is an
 * unordered pair of criterion codes that must never both be `met: true` at the same time.
 * Runs after criteria are evaluated but before scoring — on any violation, scoring is
 * skipped and the caller must return `status: "invalid"`.
 */
const INCOMPATIBLE_PAIRS: Array<[string, string]> = [
  ["OM1", "OS1"],
  ["OM1", "OS3"],
  ["OM2", "OVS1"],
  ["OM3", "OM1"],
  ["OM3", "OM4"],
  ["OM4", "OS1"],
  ["OM4", "OS3"],
  ["OM4", "OM1"],
  ["OP1", "SBP1"],
  ["OS2", "SBS2"],
  ["OS3", "OM3"],
  ["OS3", "OP3"],
  ["OM3", "OP3"],
];

export const OncogenicityCompatibilityValidator = {
  /**
   * Validates a fully-evaluated criteria list against the incompatibility matrix, plus
   * the two hard variant-type gates (OVS1 never missense, OM2 never plain missense SNV)
   * as a defense-in-depth re-check independent of the engine's own gating.
   */
  validate(criteria: CriterionOutcome[], opts?: { isMissense?: boolean; isPlainMissenseSnv?: boolean }): OncogenicityValidationResult {
    const metCodes = new Set(criteria.filter((c) => c.met === true).map((c) => c.code));
    const errors: string[] = [];

    for (const [a, b] of INCOMPATIBLE_PAIRS) {
      if (metCodes.has(a) && metCodes.has(b)) {
        errors.push(`incompatible_criteria: ${a} and ${b} cannot both be met simultaneously`);
      }
    }

    if (opts?.isMissense && metCodes.has("OVS1")) {
      errors.push("incompatible_criteria: OVS1 cannot be met for a missense variant");
    }
    if (opts?.isPlainMissenseSnv && metCodes.has("OM2")) {
      errors.push("incompatible_criteria: OM2 cannot be met for a plain missense SNV");
    }

    return { valid: errors.length === 0, validationErrors: errors };
  },
};

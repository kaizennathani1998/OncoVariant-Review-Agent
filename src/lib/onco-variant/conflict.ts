import type { ExternalAssertion } from "./types";

/**
 * Shared helper used by germline/oncogenicity external-assertion selection and by the
 * orchestrator's manual-review flagging. Priority order (never a majority vote):
 * framework relevance > exact allele match > exact disease match > expert-panel/
 * guideline authority > date > transparency > source version.
 *
 * Only the authority/date/transparency tiers are computable from data this engine
 * actually has today (framework relevance and exact-allele/-disease match require
 * richer per-assertion allele/disease fields than the current adapters populate); those
 * tiers are documented here as fixed policy for when such fields are added.
 */
const AUTHORITY_ORDER = ["practice_guideline", "expert_panel", "multiple_concordant", "single_with_criteria", "single_without_criteria", "unspecified"];

export const ConflictResolver = {
  rank(assertions: ExternalAssertion[]): ExternalAssertion[] {
    return [...assertions].sort((a, b) => {
      const authorityDelta = AUTHORITY_ORDER.indexOf(a.authority) - AUTHORITY_ORDER.indexOf(b.authority);
      if (authorityDelta !== 0) return authorityDelta;
      const dateDelta = (b.lastEvaluated ?? "").localeCompare(a.lastEvaluated ?? "");
      return dateDelta;
    });
  },

  /** True when the internal computation's classification meaningfully disagrees with the top-ranked external assertion. */
  disagrees(internalClassification: string | null, externalAssertions: ExternalAssertion[]): boolean {
    if (!internalClassification || !externalAssertions.length) return false;
    const top = ConflictResolver.rank(externalAssertions)[0];
    const normalize = (v: string) => v.toLowerCase().replace(/^likely /, "").trim();
    return normalize(top.classification) !== normalize(internalClassification) && !/uncertain|vus/i.test(internalClassification);
  },
};

import type { EngineInput } from "./engine-input";
import type { ClassificationBasis, ExternalAssertion, ExternalAssertionAuthority, GermlineSignificance, InternalComputation } from "./types";

/**
 * Local authority ranking, documented here as policy (not a rule from any single body):
 * practice_guideline > expert_panel > multiple_concordant > single_with_criteria >
 * single_without_criteria. Used only to pick which external assertion is surfaced as
 * primary when more than one track/source disagrees — never a majority vote.
 */
const AUTHORITY_RANK: Record<ExternalAssertionAuthority, number> = {
  practice_guideline: 5,
  expert_panel: 4,
  multiple_concordant: 3,
  single_with_criteria: 2,
  single_without_criteria: 1,
  unspecified: 0,
};

function inferAuthority(reviewStatus: string | undefined): ExternalAssertionAuthority {
  const value = reviewStatus?.toLowerCase() ?? "";
  if (value.includes("practice guideline")) return "practice_guideline";
  if (value.includes("expert panel")) return "expert_panel";
  if (value.includes("multiple submitters") && value.includes("no conflict")) return "multiple_concordant";
  if (value.includes("criteria provided")) return "single_with_criteria";
  if (value.includes("no assertion criteria")) return "single_without_criteria";
  return "unspecified";
}

/**
 * Parses ClinVar's germline classification track into `external_assertions[]`. This is
 * the ONLY place a ClinVar germline record (including one curated by any gene-specific
 * expert panel, TP53's included) enters the germline output — as an opaque, structurally
 * separate assertion, never converted into an ACMG/AMP criterion.
 */
export function buildGermlineExternalAssertions(input: EngineInput): ExternalAssertion[] {
  const classification = input.clinvar.germlineClassification;
  if (!classification?.description) return [];
  return [
    {
      source: "ClinVar",
      track: "germline",
      classification: classification.description,
      reviewStatus: classification.reviewStatus,
      conditions: classification.conditions,
      authority: inferAuthority(classification.reviewStatus),
      lastEvaluated: classification.lastEvaluated,
      sourceLink: input.clinvar.sourceLink,
    },
  ];
}

export function selectPrimaryGermlineClassification(
  externalAssertions: ExternalAssertion[],
  internalComputation: InternalComputation,
  sourceUnavailable = false,
): { primaryClassification: string; classificationBasis: ClassificationBasis } {
  if (externalAssertions.length > 0) {
    const highest = [...externalAssertions].sort((a, b) => AUTHORITY_RANK[b.authority] - AUTHORITY_RANK[a.authority])[0];
    return { primaryClassification: highest.classification, classificationBasis: "external_curated_assertion" };
  }
  if (internalComputation.status === "incomplete" && sourceUnavailable) {
    return { primaryClassification: "Not computed", classificationBasis: "internal_computation" };
  }
  return { primaryClassification: internalComputation.classification ?? "VUS", classificationBasis: "internal_computation" };
}

export function buildGermlineCaveats(externalAssertions: ExternalAssertion[], internalComputation: InternalComputation): string[] {
  const caveats: string[] = [];
  if (internalComputation.status === "incomplete") {
    caveats.push("The internal ACMG/AMP computation is incomplete: one or more load-bearing criteria could not be assessed from available data, so no final internally-computed categorical verdict is claimed.");
  }
  if (externalAssertions.length && internalComputation.status !== "complete") {
    caveats.push("An external curated assertion is shown as the primary classification because the internal computation is incomplete. This does not mean the internal engine independently reproduced that classification.");
  }
  if (!externalAssertions.length && internalComputation.criteriaNotAssessed.length > 0) {
    caveats.push("No external curated germline assertion was found; the internal computation's classification is shown as primary despite being incomplete.");
  }
  return caveats;
}

export function buildGermlineSignificance(input: EngineInput, internalComputation: InternalComputation): GermlineSignificance {
  const externalAssertions = buildGermlineExternalAssertions(input);
  const sourceUnavailable = [input.clinvar.status, input.gnomad.status, input.computationalPrediction.status].some((status) => ["query_failed", "rate_limited", "permission_denied"].includes(status));
  const { primaryClassification, classificationBasis } = selectPrimaryGermlineClassification(externalAssertions, internalComputation, sourceUnavailable);
  return {
    externalAssertions,
    primaryClassification,
    classificationBasis,
    internalComputation,
    caveats: buildGermlineCaveats(externalAssertions, internalComputation),
  };
}

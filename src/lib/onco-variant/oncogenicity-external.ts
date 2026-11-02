import type { EngineInput } from "./engine-input";
import type { ClassificationBasis, ExternalAssertion, ExternalAssertionAuthority, InternalComputation } from "./types";

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
 * Parses ClinVar's somatic-oncogenicity track and OncoKB's oncogenicity label into
 * `external_assertions[]`. This is the ONLY place either source's oncogenicity label
 * enters the output — never auto-converted into OS1/OS3 or any other internally-computed
 * criterion. A ClinVar oncogenicity record curated by ANY expert panel — including,
 * incidentally, a TP53 variant's ClinGen TP53 VCEP-curated record — is treated exactly
 * like any other gene's expert-panel record: opaque data, never internal logic.
 */
export function buildOncogenicityExternalAssertions(input: EngineInput): ExternalAssertion[] {
  const assertions: ExternalAssertion[] = [];
  const clinvarOnco = input.clinvar.oncogenicityClassification;
  if (clinvarOnco?.description) {
    assertions.push({
      source: "ClinVar",
      track: "oncogenicity",
      classification: clinvarOnco.description,
      reviewStatus: clinvarOnco.reviewStatus,
      conditions: clinvarOnco.conditions,
      authority: inferAuthority(clinvarOnco.reviewStatus),
      lastEvaluated: clinvarOnco.lastEvaluated,
      sourceLink: input.clinvar.sourceLink,
    });
  }
  if (input.oncokb.status === "available" && input.oncokb.oncogenicity) {
    assertions.push({
      source: "OncoKB",
      track: "oncogenicity",
      classification: input.oncokb.oncogenicity,
      conditions: [],
      authority: "single_without_criteria",
      sourceLink: input.oncokb.sourceLink,
    });
  }
  return assertions;
}

export function selectPrimaryOncogenicityClassification(
  externalAssertions: ExternalAssertion[],
  internalComputation: InternalComputation,
  sourceUnavailable = false,
): { primaryClassification: string; classificationBasis: ClassificationBasis } {
  const internalUsable = internalComputation.status === "complete";
  if (!internalUsable && externalAssertions.length > 0) {
    const highest = [...externalAssertions].sort((a, b) => AUTHORITY_RANK[b.authority] - AUTHORITY_RANK[a.authority])[0];
    return { primaryClassification: highest.classification, classificationBasis: "external_curated_assertion" };
  }
  if (externalAssertions.length > 0 && internalComputation.classification === null) {
    const highest = [...externalAssertions].sort((a, b) => AUTHORITY_RANK[b.authority] - AUTHORITY_RANK[a.authority])[0];
    return { primaryClassification: highest.classification, classificationBasis: "external_curated_assertion" };
  }
  if (internalComputation.status === "incomplete" && sourceUnavailable) {
    return { primaryClassification: "Not computed", classificationBasis: "internal_computation" };
  }
  return { primaryClassification: internalComputation.classification ?? "VUS", classificationBasis: "internal_computation" };
}

export function buildOncogenicityCaveats(externalAssertions: ExternalAssertion[], internalComputation: InternalComputation): string[] {
  const caveats: string[] = [];
  if (internalComputation.status === "invalid") {
    caveats.push(`The internal computation was rejected as invalid: ${internalComputation.validationErrors.join("; ")}. No internally-computed score or classification is reported.`);
  } else if (internalComputation.status === "incomplete") {
    caveats.push("The internal CGC-VICC computation is incomplete: one or more load-bearing criteria could not be assessed from available data.");
  }
  if (externalAssertions.length && internalComputation.status !== "complete") {
    caveats.push("An external curated assertion is shown as the primary classification. This is a reported classification from an external database, not an independently reproduced internal computation, and is never converted into an internal criterion such as OS1 or OS3.");
  }
  return caveats;
}

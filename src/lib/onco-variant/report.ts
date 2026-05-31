import type { VariantReviewResponse } from "./types";

export function buildMarkdownReport(result: VariantReviewResponse) {
  const v = result.normalizedVariant;
  return [
    "# OncoVariant Review Agent Report",
    "",
    "## Variant",
    `- Genomic: ${v.genomicHgvs}`,
    `- Build: ${v.build}`,
    `- Gene: ${v.gene ?? "Not provided"}`,
    `- Protein change: ${v.proteinChange ?? "Not provided"}`,
    `- Cancer type: ${v.cancerType ?? "Not provided"}`,
    `- UCSC Browser: ${result.ucscUrl}`,
    "",
    `## ClinVar (${result.clinvar.status})`,
    `- Clinical significance: ${result.clinvar.clinicalSignificance ?? "Not found"}`,
    `- Condition: ${result.clinvar.diseaseCondition ?? "Not found"}`,
    `- Review status: ${result.clinvar.reviewStatus ?? "Not found"}`,
    `- Variation ID: ${result.clinvar.variationId ?? "Not found"}`,
    `- VCV accession: ${result.clinvar.vcvAccession ?? "Not found"}`,
    `- HGVS: ${result.clinvar.hgvsNames.join("; ") || "Not found"}`,
    "",
    `## OncoKB (${result.oncokb.status})`,
    `- Oncogenicity: ${result.oncokb.oncogenicity ?? "Not found"}`,
    `- Mutation effect: ${result.oncokb.mutationEffect ?? "Not found"}`,
    `- Evidence level: ${result.oncokb.evidenceLevel ?? "Not found"}`,
    `- Drugs: ${result.oncokb.drugs.join(", ") || "Not found"}`,
    "",
    `## cBioPortal (${result.cbioportal.status})`,
    `- Matching studies: ${result.cbioportal.matchingStudies.map((study) => study.name).join("; ") || "Not found"}`,
    `- Tumor types: ${result.cbioportal.tumorTypes.join(", ") || "Not found"}`,
    "",
    "## AI Summary",
    result.aiSummary,
  ].join("\n");
}


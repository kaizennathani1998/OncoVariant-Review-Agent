import type { ClinVarClassification, CriterionOutcome, GermlineSignificance, SomaticOncogenicity, VariantReviewResponse } from "./types";

function formatClassification(classification?: ClinVarClassification) {
  if (!classification?.description) return "Not submitted";
  const conditions = classification.conditions.length ? ` for ${classification.conditions.join(", ")}` : "";
  return `${classification.description}${conditions} (${classification.reviewStatus ?? "review status not provided"})`;
}

function formatCriterion(criterion: CriterionOutcome) {
  const metLabel = criterion.met === "not_assessed" ? "not assessed" : criterion.met === "not_applicable" ? "not applicable" : criterion.met ? "met" : "not met";
  const suffix = (criterion.met === "not_assessed" || criterion.met === "not_applicable") && criterion.reason ? ` — ${criterion.reason}` : ` — ${criterion.rationale}`;
  return `  - ${criterion.code} (${criterion.strength}): ${metLabel}${suffix}`;
}

/** Renders `externalAssertions` and `internalComputation` as visually distinct blocks — never merged into one line. */
function formatDomainBlock(label: string, domain: GermlineSignificance | SomaticOncogenicity) {
  const lines = [
    `### ${label}`,
    `- Primary classification: ${domain.primaryClassification} (basis: ${domain.classificationBasis})`,
    "",
    "**External assertions (opaque, curated by others — never converted into an internal criterion):**",
    ...(domain.externalAssertions.length
      ? domain.externalAssertions.map((a) => `  - ${a.source} (${a.track}): ${a.classification}${a.reviewStatus ? ` — ${a.reviewStatus}` : ""}${a.conditions.length ? ` for ${a.conditions.join(", ")}` : ""}`)
      : ["  - None found."]),
    "",
    `**Internal computation (${domain.internalComputation.framework}, status: ${domain.internalComputation.status}):**`,
    `  - Classification: ${domain.internalComputation.classification ?? "Not computed"}`,
    `  - Score: ${domain.internalComputation.score ?? "Not computed"}`,
    ...(domain.internalComputation.status === "invalid" ? [`  - Validation errors: ${domain.internalComputation.validationErrors.join("; ")}`] : []),
    "  - Criteria met:",
    ...(domain.internalComputation.criteriaMet.length ? domain.internalComputation.criteriaMet.map(formatCriterion) : ["    (none)"]),
    "  - Criteria not met:",
    ...(domain.internalComputation.criteriaNotMet.length ? domain.internalComputation.criteriaNotMet.map(formatCriterion) : ["    (none)"]),
    "  - Criteria not assessed:",
    ...(domain.internalComputation.criteriaNotAssessed.length ? domain.internalComputation.criteriaNotAssessed.map(formatCriterion) : ["    (none)"]),
    "  - Criteria not applicable:",
    ...(domain.internalComputation.criteriaNotApplicable.length ? domain.internalComputation.criteriaNotApplicable.map(formatCriterion) : ["    (none)"]),
    "  - Criteria suppressed by policy:",
    ...(domain.internalComputation.criteriaSuppressed.length ? domain.internalComputation.criteriaSuppressed.map(formatCriterion) : ["    (none)"]),
    "",
    ...(domain.caveats.length ? ["**Caveats:**", ...domain.caveats.map((c) => `  - ${c}`)] : []),
  ];
  return lines.join("\n");
}

export function buildMarkdownReport(result: VariantReviewResponse) {
  const v = result.normalizedVariant;
  const c = result.classification;
  return [
    "# OncoLens AI Report",
    "",
    "## Variant",
    `- Genomic: ${v.genomicHgvs}`,
    `- Build: ${v.build}`,
    `- Gene: ${v.gene ?? "Not provided"}`,
    `- Protein change: ${v.proteinChange ?? "Not provided"}`,
    `- Cancer type: ${v.cancerType ?? "Not provided"}`,
    `- Disease: ${v.disease ?? "Not provided"}`,
    `- Specimen material: ${v.specimenMaterial ?? "Not provided"}`,
    `- VAF: ${v.vaf !== undefined ? `${(v.vaf * 100).toFixed(1)}%` : "Not provided"}`,
    `- UCSC Browser hg19: ${result.ucscUrls.hg19}`,
    `- UCSC Browser hg38: ${result.ucscUrls.hg38}`,
    `- Liftover: ${v.liftover.message}`,
    ...(v.canonicalTranscript ? [`- Canonical transcript: ${v.canonicalTranscript}`] : []),
    ...(v.codingHgvs ? [`- Coding HGVS: ${v.codingHgvs}`] : []),
    ...(v.proteinHgvs ? [`- Protein HGVS: ${v.proteinHgvs}`] : []),
    ...(v.spdi ? [`- SPDI: ${v.spdi}`] : []),
    "",
    `## ClinVar (${result.clinvar.status})`,
    `- Germline classification: ${formatClassification(result.clinvar.germlineClassification)}`,
    `- Somatic clinical impact: ${formatClassification(result.clinvar.somaticClinicalImpact)}`,
    `- Oncogenicity classification: ${formatClassification(result.clinvar.oncogenicityClassification)}`,
    `- Variant type: ${result.clinvar.variantType ?? "Not found"}`,
    `- cDNA change: ${result.clinvar.cdnaChange ?? "Not found"}`,
    `- Molecular consequence: ${result.clinvar.molecularConsequence.join("; ") || "Not found"}`,
    `- Population frequency: ${result.clinvar.populationFrequencies.map((freq) => `${freq.source}: ${freq.value}`).join("; ") || "Not found"}`,
    `- HGVS: ${result.clinvar.hgvsNames.join("; ") || "Not found"}`,
    "",
    `## OncoKB (${result.oncokb.status})`,
    `- Oncogenicity: ${result.oncokb.oncogenicity ?? "Not found"}`,
    `- Hotspot: ${result.oncokb.hotspot === undefined ? "Not found" : result.oncokb.hotspot ? "Yes" : "No"}`,
    `- Mutation effect: ${result.oncokb.mutationEffect ?? "Not found"}`,
    `- Drugs: ${result.oncokb.drugs.join(", ") || "Not found"}`,
    "",
    `## cBioPortal (${result.cbioportal.status})`,
    `- Matching studies: ${result.cbioportal.matchingStudies.map((study) => study.name).join("; ") || "Not found"}`,
    `- Tumor types: ${result.cbioportal.tumorTypes.join(", ") || "Not found"}`,
    `- Mutation count: ${result.cbioportal.mutationCount ?? "Not found"}`,
    "",
    `## AACR GENIE (${result.aacrGenie.status})`,
    `- Matching studies: ${result.aacrGenie.matchingStudies.map((study) => study.name).join("; ") || "Not found"}`,
    `- Mutation count: ${result.aacrGenie.mutationCount ?? "Not found"}`,
    `- Caveat: ${result.aacrGenie.caveat ?? "None"}`,
    "",
    `## gnomAD (${result.gnomad.status})`,
    `- Allele frequency: ${result.gnomad.alleleFrequency ?? "Not found"}`,
    `- Population max frequency: ${result.gnomad.popmaxFrequency ?? "Not found"}${result.gnomad.popmaxPopulation ? ` (${result.gnomad.popmaxPopulation})` : ""}`,
    `- Dataset/release: ${result.gnomad.dataset ?? "Not found"} / ${result.gnomad.release ?? "Not found"}`,
    "",
    `## Computational prediction (${result.computationalPrediction.status})`,
    `- REVEL score: ${result.computationalPrediction.revelScore ?? "Not found"}`,
    `- AlphaMissense score: ${result.computationalPrediction.alphaMissenseScore ?? "Not found"}`,
    "",
    `## CIViC (${result.civic.status})`,
    `- Molecular profiles: ${result.civic.molecularProfiles.map((profile) => `${profile.name}${profile.evidenceItemCount !== undefined ? ` (${profile.evidenceItemCount} evidence item(s))` : ""}`).join("; ") || "Not found"}`,
    `- Caveat: ${result.civic.caveat ?? "None"}`,
    "",
    `## COSMIC (${result.cosmic.status})`,
    `- Matches: ${result.cosmic.matches.map((match) => [match.gene, match.mutation, match.disease].filter(Boolean).join(" ")).join("; ") || "Not imported"}`,
    `- Caveat: ${result.cosmic.caveat ?? "None"}`,
    "",
    "## Practical Import Package",
    ...Object.entries(result.practicalImportPackage)
      .filter(([key]) => key !== "caveats")
      .map(([key, value]) => `- ${key}: ${value}`),
    ...(result.practicalImportPackage.caveats.length ? ["- Caveats:", ...result.practicalImportPackage.caveats.map((cav) => `  - ${cav}`)] : []),
    "",
    "## Classification — four independent outputs",
    "",
    "These four outputs are never merged into a single phrase or verdict.",
    "",
    formatDomainBlock("(A) Germline pathogenicity (ACMG/AMP 2015)", c.germlineSignificance),
    "",
    formatDomainBlock("(B) Somatic oncogenicity (ClinGen-CGC-VICC / AMP-ASCO-CAP)", c.somaticOncogenicity),
    "",
    "### (C) Somatic clinical impact (per axis, disease-specific)",
    ...(c.somaticClinicalImpact.disease ? [`- Disease: ${c.somaticClinicalImpact.disease.submitted} (normalized: ${c.somaticClinicalImpact.disease.normalizedName ?? "n/a"}, mapping confidence: ${c.somaticClinicalImpact.disease.mappingConfidence ?? "none"})`] : ["- No disease was submitted."]),
    ...c.somaticClinicalImpact.axes.map((axis) => `  - ${axis.axis}: ${axis.status}${axis.tier ? ` (${axis.tier})` : ""} — ${axis.reason ?? "no reason given"}`),
    ...(c.somaticClinicalImpact.caveats.length ? ["- Caveats:", ...c.somaticClinicalImpact.caveats.map((cav) => `  - ${cav}`)] : []),
    "",
    "### (D) Specimen-origin interpretation",
    `- Conclusion: ${c.originAssessment.conclusion}`,
    `- Specimen role: ${c.originAssessment.specimenRole} (material: ${c.originAssessment.specimenMaterial ?? "not provided"})`,
    `- Germline not excluded: ${c.originAssessment.germlineNotExcluded}`,
    `- Clonal hematopoiesis possible: ${c.originAssessment.clonalHematopoiesisPossible}`,
    `- Copy-number/LOH possible: ${c.originAssessment.copyNumberOrLohPossible}`,
    ...(c.originAssessment.caveats.length ? ["- Caveats:", ...c.originAssessment.caveats.map((cav) => `  - ${cav}`)] : []),
    "",
    ...(c.manualReviewFlags.length ? ["### Manual review flags", ...c.manualReviewFlags.map((f) => `  - [${f.domain}] ${f.reason}`)] : []),
    "",
    "## AI Summary",
    result.aiSummary,
  ].join("\n");
}

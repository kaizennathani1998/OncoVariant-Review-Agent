import type { EngineInput } from "./engine-input";
import { diseaseMappingConfidence, matchDisease, normalizeDisease } from "./disease.ts";
import type { ClinicalImpactAxis, DiseaseMatchCategory, SomaticClinicalImpact } from "./types";

export type ClinicalImpactAxisName = "therapeutic" | "diagnostic" | "prognostic";
export type ClinicalImpactTier = "Tier_I" | "Tier_II" | "Tier_III" | "Tier_IV";

export type DiseaseGuidelineRule = {
  id: string;
  version: string;
  guideline: string;
  gene?: string;
  disease: string;
  axis: ClinicalImpactAxisName;
  evidenceLevel: "A" | "B" | "C" | "D";
  direction: "adverse" | "favorable" | "actionable" | "diagnostic_marker";
  description: string;
  requiredConditions?: string[];
  defaultMissingRequirements?: string[];
};

/**
 * Registry of versioned, disease-specific clinical-impact rule objects. This is a small
 * generic seed set — nothing here is ClinGen TP53 VCEP logic, and the registry is not
 * gene-specific: `ELN_2022_INTENSIVE_TP53_ADVERSE` is one entry among several, keyed by
 * gene the same way `ELN_2022_NPM1_FAVORABLE` is. Both come from the European
 * LeukemiaNet (ELN) 2022 AML risk-stratification recommendations, a general
 * clinical-outcome guideline unrelated to ClinGen's variant-curation expert panels.
 */
export const DiseaseGuidelineRegistry: DiseaseGuidelineRule[] = [
  {
    id: "ELN_2022_INTENSIVE_TP53_ADVERSE",
    version: "2022.1",
    guideline: "European LeukemiaNet (ELN) 2022 AML risk stratification",
    gene: "TP53",
    disease: "Acute myeloid leukemia",
    axis: "prognostic",
    evidenceLevel: "A",
    direction: "adverse",
    description: "TP53 mutation (any) is classified as an adverse-risk marker for intensively treated AML under ELN 2022 risk stratification.",
    requiredConditions: ["AML diagnosis", "intensive-treatment risk-stratification context"],
    defaultMissingRequirements: ["treatment_context"],
  },
  {
    id: "ICC_WHO_TP53_AML_DIAGNOSTIC_CONTEXT",
    version: "2022.1",
    guideline: "ICC/WHO AML diagnostic framework seed rule",
    gene: "TP53",
    disease: "Acute myeloid leukemia",
    axis: "diagnostic",
    evidenceLevel: "A",
    direction: "diagnostic_marker",
    description: "TP53 mutation can be diagnostically relevant in AML classification, but the sparse request model lacks blast percentage, complete molecular/cytogenetic context, and diagnostic hierarchy needed to assign a final diagnostic tier.",
    requiredConditions: ["blast percentage", "complete molecular context", "diagnostic hierarchy"],
    defaultMissingRequirements: ["blast_percentage", "complete_molecular_context", "diagnostic_hierarchy"],
  },
  {
    id: "ELN_2022_NPM1_FAVORABLE",
    version: "2022.1",
    guideline: "European LeukemiaNet (ELN) 2022 AML risk stratification",
    gene: "NPM1",
    disease: "Acute myeloid leukemia",
    axis: "prognostic",
    evidenceLevel: "A",
    direction: "favorable",
    description: "NPM1 mutation without FLT3-ITD is classified as a favorable-risk marker for intensively treated AML under ELN 2022 risk stratification (FLT3-ITD status not captured by this engine; treat as a caveat).",
  },
  {
    id: "NCCN_CRC_KRAS_RESISTANCE",
    version: "2024.3",
    guideline: "NCCN Colon Cancer clinical practice guideline",
    gene: "KRAS",
    disease: "Colorectal cancer",
    axis: "therapeutic",
    evidenceLevel: "A",
    direction: "actionable",
    description: "KRAS activating mutation predicts resistance to anti-EGFR monoclonal antibody therapy in colorectal cancer.",
  },
];

function findRule(gene: string | undefined, diseaseMatch: DiseaseMatchCategory, disease: string | undefined, axis: ClinicalImpactAxisName): DiseaseGuidelineRule | undefined {
  if (!gene || diseaseMatch === "unrelated" || diseaseMatch === "ambiguous") return undefined;
  const normalizedDisease = normalizeDisease(disease)?.normalizedName;
  return DiseaseGuidelineRegistry.find(
    (rule) => rule.axis === axis && rule.gene?.toUpperCase() === gene.toUpperCase() && rule.disease === normalizedDisease,
  );
}

function levelToTier(level: DiseaseGuidelineRule["evidenceLevel"]): ClinicalImpactTier {
  if (level === "A" || level === "B") return "Tier_I";
  return "Tier_II";
}

function sourcesReachedForClinicalSearch(input: EngineInput): boolean {
  const reachable = (status: string) => status === "available" || status === "not_found" || status === "not_returned";
  return reachable(input.oncokb.status) && reachable(input.clinvar.status);
}

function isAcceptedBenign(primaryClassification: string): boolean {
  return /benign/i.test(primaryClassification);
}

function evaluateAxis(
  axisName: ClinicalImpactAxisName,
  input: EngineInput,
  diseaseMatch: DiseaseMatchCategory,
  oncogenicityPrimaryClassification: string,
): ClinicalImpactAxis {
  const gene = input.normalizedVariant.gene;
  const disease = input.normalizedVariant.disease ?? input.normalizedVariant.cancerType;
  const vaf = input.normalizedVariant.vaf;

  if (axisName === "therapeutic") {
    // treatment_context is never supplied by this request model today, so the
    // therapeutic axis can never claim a fully-assessed tier — it must say so plainly
    // rather than silently defaulting to Tier III.
    const missing: string[] = ["treatment_context"];
    if (vaf === undefined) missing.push("vaf");
    return {
      axis: "therapeutic",
      status: "applicability_not_fully_assessable",
      reason: "Therapeutic actionability requires the current treatment context (line of therapy, prior exposures, concurrent alterations), which this request model does not capture.",
      missingRequirements: missing,
      conditionsMissing: missing,
      applicabilityStatus: "context_incomplete",
      sourceDisease: disease,
      submittedDisease: disease,
      diseaseMatch,
    };
  }

  if (isAcceptedBenign(oncogenicityPrimaryClassification)) {
    return {
      axis: axisName,
      status: "tier_assigned",
      tier: "Tier_IV",
      reason: "A benign/likely-benign oncogenicity classification is accepted; no disease-specific clinical impact is expected for this axis.",
      implication: "no_expected_clinical_impact",
      applicabilityStatus: "complete",
      sourceDisease: disease,
      submittedDisease: disease,
      diseaseMatch,
    };
  }

  const rule = findRule(gene, diseaseMatch, disease, axisName);
  if (rule) {
    const missingRequirements = rule.defaultMissingRequirements ?? [];
    if (axisName === "diagnostic" && missingRequirements.length) {
      return {
        axis: axisName,
        status: "applicability_not_fully_assessable",
        tier: levelToTier(rule.evidenceLevel),
        evidenceLevel: rule.evidenceLevel,
        implication: rule.direction,
        sourceDisease: rule.disease,
        submittedDisease: disease,
        guidelineOrRegulatorySource: rule.guideline,
        guidelineVersion: rule.version,
        requiredConditions: rule.requiredConditions,
        conditionsMet: ["gene", "disease"],
        conditionsMissing: missingRequirements,
        missingRequirements,
        applicabilityStatus: "not_fully_assessable",
        matchedRule: rule.id,
        matchedRuleVersion: rule.version,
        reason: rule.description,
        diseaseMatch,
      };
    }
    return {
      axis: axisName,
      status: "tier_assigned",
      tier: levelToTier(rule.evidenceLevel),
      evidenceLevel: rule.evidenceLevel,
      implication: rule.direction,
      sourceDisease: rule.disease,
      submittedDisease: disease,
      guidelineOrRegulatorySource: rule.guideline,
      guidelineVersion: rule.version,
      requiredConditions: rule.requiredConditions,
      conditionsMet: ["gene", "disease"],
      conditionsMissing: missingRequirements,
      missingRequirements: missingRequirements.length ? missingRequirements : undefined,
      applicabilityStatus: missingRequirements.length ? "context_incomplete" : "complete",
      matchedRule: rule.id,
      matchedRuleVersion: rule.version,
      reason: rule.description,
      diseaseMatch,
    };
  }

  if (!sourcesReachedForClinicalSearch(input)) {
    return {
      axis: axisName,
      status: "not_computed",
      reason: "required_clinical_sources_unavailable",
      sourceDisease: disease,
      submittedDisease: disease,
      applicabilityStatus: "source_unavailable",
      diseaseMatch,
    };
  }

  return {
    axis: axisName,
    status: "tier_assigned",
    tier: "Tier_III",
    reason: "A disease-specific search completed successfully and found no matching clinical-impact guideline rule for this gene/disease/axis combination.",
    sourceDisease: disease,
    submittedDisease: disease,
    applicabilityStatus: "complete",
    diseaseMatch,
  };
}

export const ClinicalImpactEngine = {
  evaluate(input: EngineInput, oncogenicityPrimaryClassification: string): SomaticClinicalImpact {
    const submittedDisease = input.normalizedVariant.disease ?? input.normalizedVariant.cancerType;
    const sourceDisease = input.oncokb.tumorTypeSummary ?? submittedDisease;
    const concept = normalizeDisease(submittedDisease);
    const diseaseMatch = matchDisease(sourceDisease, submittedDisease);

    const axes: ClinicalImpactAxis[] = (["therapeutic", "diagnostic", "prognostic"] as ClinicalImpactAxisName[]).map((axis) =>
      evaluateAxis(axis, input, diseaseMatch, oncogenicityPrimaryClassification),
    );

    const caveats: string[] = [
      "Each axis (therapeutic, diagnostic, prognostic) is evaluated independently; a tier on one axis never implies a tier on another.",
    ];
    if (!submittedDisease) {
      caveats.push("No disease/cancer type was submitted; disease-specific clinical-impact rules could not be matched with confidence.");
    }

    return {
      disease: submittedDisease
        ? {
            submitted: submittedDisease,
            normalizedName: concept?.normalizedName,
            ontologyId: concept?.ontologyId,
            mappingConfidence: diseaseMappingConfidence(concept),
          }
        : undefined,
      axes,
      caveats,
    };
  },
};

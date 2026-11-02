import type { EngineInput } from "./engine-input";
import { normalizeDisease } from "./disease.ts";
import type { CriterionOutcome, CriterionStrength, InternalComputation, NotAssessedReason } from "./types";

const REQUIRED_DATA_UNAVAILABLE: NotAssessedReason = "required_data_unavailable";

const NOT_ASSESSABLE_GENE_LOOKUP = "Requires a curated gene-level lookup (tumor-suppressor loss-of-function mechanism) not yet integrated.";
const NOT_ASSESSABLE_FUNCTIONAL_STUDY = "Requires a dedicated functional-study database not yet integrated.";
const NOT_ASSESSABLE_CONTROLS = "Requires a matched case-control cohort database not yet integrated.";
const NOT_ASSESSABLE_HOTSPOT_SIGNIFICANCE = "Requires a quantitative hotspot-significance database (e.g. tumor recurrence q-value with position>=50 / substitution>=10 count thresholds) not yet integrated; OncoKB's hotspot flag only supports the plain OM1 hotspot criterion.";
const OS1_INDEPENDENCE_NOTE = "OS1 requires an independently established oncogenic record for a DIFFERENT variant. The variant's own ClinVar/OncoKB label can never be used to satisfy this criterion (that would be circular). No independent different-variant lookup is integrated.";

const POINTS: Record<CriterionStrength, number> = {
  "very-strong": 8,
  strong: 4,
  moderate: 2,
  supporting: 1,
  "stand-alone": 8, // magnitude only; sign applied by caller based on SB-prefix
};

function outcome(
  code: string,
  strength: CriterionStrength,
  met: boolean | "not_assessed" | "not_applicable",
  rationale: string,
  opts?: { reason?: string; notAssessedReason?: NotAssessedReason },
): CriterionOutcome {
  const isBenignCode = /^SB/.test(code);
  const magnitude = met === true ? Math.abs(POINTS[strength]) : 0;
  return {
    code,
    strength,
    met,
    points: met === true ? (isBenignCode ? -magnitude : magnitude) : 0,
    rationale,
    reason: opts?.reason,
    notAssessedReason: met === "not_assessed" ? opts?.notAssessedReason ?? REQUIRED_DATA_UNAVAILABLE : undefined,
  };
}

function notAssessed(code: string, strength: CriterionStrength, reason: string): CriterionOutcome {
  return outcome(code, strength, "not_assessed", "Not assessable from available data.", { reason });
}

function notApplicable(code: string, strength: CriterionStrength, reason: string): CriterionOutcome {
  return outcome(code, strength, "not_applicable", "Not applicable to this variant type or disease context.", { reason });
}

function isPlainMissenseSnv(input: EngineInput): boolean {
  const variantType = input.normalizedVariant.variantType;
  const consequence = input.clinvar.molecularConsequence.join(" ").toLowerCase();
  const looksMissense = /missense/.test(consequence);
  return (variantType === "SNV" || variantType === undefined) && (looksMissense || Boolean(input.normalizedVariant.proteinChange));
}

function isLossOfFunctionVariantType(input: EngineInput): boolean {
  const consequence = input.clinvar.molecularConsequence.join(" ").toLowerCase();
  return /nonsense|frameshift|stop.?gain|splice.?(donor|acceptor)/.test(consequence);
}

function excludedForDisease(input: EngineInput, code: string, excludedDiseases: string[]): boolean {
  const disease = input.normalizedVariant.disease ?? input.normalizedVariant.cancerType;
  const concept = normalizeDisease(disease);
  if (!concept) return false;
  return excludedDiseases.some((excluded) => normalizeDisease(excluded)?.normalizedName === concept.normalizedName);
}

export type OncogenicityEngineResult = Omit<InternalComputation, "validationErrors"> & { allCriteria: CriterionOutcome[] };

/**
 * Generic ClinGen-CGC-VICC / AMP-ASCO-CAP oncogenicity engine. Never TP53-specific, never
 * gene-specific beyond the disease-level OP2/AML carve-out named explicitly in the plan
 * (a generic recurrence-vs-disease-prevalence caveat, not a TP53 rule). OS1/OS3 never read
 * the variant's own external label (that would be circular) and stay `not_assessed` until
 * an independent different-variant/quantitative-recurrence lookup is integrated.
 */
export function runOncogenicityEngine(input: EngineInput): OncogenicityEngineResult {
  const { oncokb, cbioportal, gnomad, computationalPrediction } = input;

  const hasFunctionalEffect = Boolean(oncokb.mutationEffect && /gain-of-function|loss-of-function|switch-of-function/i.test(oncokb.mutationEffect) && oncokb.mutationEffectDescription);
  const multiTumorRecurrence = cbioportal.status === "available" && (cbioportal.tumorTypes.length >= 2 || (cbioportal.mutationCount ?? 0) >= 2);
  const popFrequency = gnomad.status === "available" ? gnomad.popmaxFrequency ?? gnomad.alleleFrequency : undefined;
  const populationDataAdequate = gnomad.status === "available" && (gnomad.qualityStatus === undefined || gnomad.qualityStatus === "available");
  const revel = computationalPrediction.revelScore;
  const alphaMissense = computationalPrediction.alphaMissenseScore;

  const plainMissenseSnv = isPlainMissenseSnv(input);
  const lofType = isLossOfFunctionVariantType(input);

  const criteria: CriterionOutcome[] = [
    plainMissenseSnv
      ? notApplicable("OVS1", "very-strong", "OVS1 applies to qualifying loss-of-function variants in bona fide tumor-suppressor genes, not to a plain missense SNV.")
      : lofType
      ? notAssessed("OVS1", "very-strong", NOT_ASSESSABLE_GENE_LOOKUP)
      : outcome("OVS1", "very-strong", false, "OVS1 is gated to loss-of-function variants in an established tumor-suppressor gene; this variant type/consequence does not qualify (never fires for missense).", { reason: "Excluded: OVS1 never applies to a missense variant." }),
    notAssessed("OS1", "strong", OS1_INDEPENDENCE_NOTE),
    notAssessed("OS2", "strong", NOT_ASSESSABLE_FUNCTIONAL_STUDY),
    notAssessed("OS3", "strong", NOT_ASSESSABLE_HOTSPOT_SIGNIFICANCE),
    notAssessed("OM1", "moderate", "Requires evidence that the variant lies in a critical and well-established functional domain; a generic hotspot flag is not sufficient."),
    plainMissenseSnv
      ? notApplicable("OM2", "moderate", "OM2 applies to qualifying in-frame protein-length changes or stop-loss variants, not to a plain missense SNV.")
      : outcome("OM2", "moderate", hasFunctionalEffect, hasFunctionalEffect ? `OncoKB reports a ${oncokb.mutationEffect} functional effect: ${oncokb.mutationEffectDescription}` : "No corroborated functional-effect description was found."),
    notAssessed("OM3", "moderate", NOT_ASSESSABLE_HOTSPOT_SIGNIFICANCE),
    notAssessed("OM4", "moderate", "OM4 requires an independently established oncogenic missense variant at the same residue; population rarity is not evidence for OM4."),
    outcome(
      "OP1",
      "supporting",
      revel !== undefined ? revel >= 0.5 : alphaMissense !== undefined ? alphaMissense >= 0.564 : "not_assessed",
      revel !== undefined ? `REVEL score ${revel} supports an oncogenic effect.` : alphaMissense !== undefined ? `AlphaMissense score ${alphaMissense} supports an oncogenic effect.` : "No computational prediction score was available.",
      { reason: revel === undefined && alphaMissense === undefined ? "Neither REVEL nor AlphaMissense could be retrieved for this variant." : undefined },
    ),
    excludedForDisease(input, "OP2", ["AML", "acute myeloid leukemia"])
      ? notApplicable("OP2", "supporting", "OP2 is not applicable to AML under this engine's disease-scoping policy; AML is not treated as a single-etiology malignancy for this criterion.")
      : outcome("OP2", "supporting", multiTumorRecurrence, multiTumorRecurrence ? `cBioPortal reports recurrence across ${cbioportal.tumorTypes.length} tumor type(s) / ${cbioportal.mutationCount ?? 0} matching mutation(s).` : "No multi-cohort recurrence was found in queried cBioPortal studies."),
    notAssessed("OP3", "supporting", NOT_ASSESSABLE_HOTSPOT_SIGNIFICANCE),
    outcome(
      "OP4",
      "supporting",
      populationDataAdequate ? (popFrequency !== undefined ? popFrequency < 0.0001 : false) : "not_assessed",
      populationDataAdequate
        ? popFrequency !== undefined && popFrequency < 0.0001
          ? `gnomAD was queried successfully with adequate status; population frequency ${popFrequency} is below the OP4 rarity threshold.`
          : `gnomAD was queried successfully with adequate status; population frequency ${popFrequency ?? "not reported"} does not satisfy the OP4 rarity threshold.`
        : "gnomAD population query did not succeed with adequate status, so OP4 cannot be gated on query success.",
      { reason: !populationDataAdequate ? "OP4 requires a successful population-database query with adequate quality/coverage validation." : undefined },
    ),
    outcome(
      "SBVS1",
      "stand-alone",
      popFrequency !== undefined ? popFrequency > 0.05 : "not_assessed",
      popFrequency !== undefined
        ? popFrequency > 0.05
          ? `gnomAD population frequency ${popFrequency} exceeds the SBVS1 threshold (5%).`
          : `gnomAD population frequency ${popFrequency} is below the SBVS1 threshold (5%).`
        : "gnomAD frequency data was not available.",
      { reason: popFrequency === undefined ? "gnomAD could not be queried." : undefined },
    ),
    outcome(
      "SBS1",
      "strong",
      popFrequency !== undefined ? popFrequency > 0.01 && popFrequency <= 0.05 : "not_assessed",
      popFrequency !== undefined
        ? popFrequency > 0.01 && popFrequency <= 0.05
          ? `gnomAD population frequency ${popFrequency} exceeds the SBS1 threshold (1%) without reaching SBVS1.`
          : `gnomAD population frequency ${popFrequency} is below the SBS1 threshold (1%) or already handled by SBVS1.`
        : "gnomAD frequency data was not available.",
      { reason: popFrequency === undefined ? "gnomAD could not be queried." : undefined },
    ),
    notAssessed("SBS2", "strong", NOT_ASSESSABLE_FUNCTIONAL_STUDY),
    outcome(
      "SBP1",
      "supporting",
      revel !== undefined ? revel < 0.3 : alphaMissense !== undefined ? alphaMissense < 0.34 : "not_assessed",
      revel !== undefined ? `REVEL score ${revel} suggests no oncogenic effect.` : alphaMissense !== undefined ? `AlphaMissense score ${alphaMissense} suggests no oncogenic effect.` : "No computational prediction score was available.",
      { reason: revel === undefined && alphaMissense === undefined ? "Neither REVEL nor AlphaMissense could be retrieved for this variant." : undefined },
    ),
    plainMissenseSnv
      ? notApplicable("SBP2", "supporting", "SBP2 applies to qualifying synonymous variants with no predicted splice impact, not to a missense SNV.")
      : notAssessed("SBP2", "supporting", NOT_ASSESSABLE_CONTROLS),
  ];

  const criteriaMet = criteria.filter((c) => c.met === true);
  const criteriaNotMet = criteria.filter((c) => c.met === false);
  const criteriaNotAssessed = criteria.filter((c) => c.met === "not_assessed");
  const criteriaNotApplicable = criteria.filter((c) => c.met === "not_applicable");
  const score = criteria.reduce((sum, c) => sum + c.points, 0);
  const classification = classifyByScore(score);

  return {
    framework: "ClinGen_CGC_VICC_2022",
    status: criteriaNotAssessed.length > 0 ? "incomplete" : "complete",
    score,
    classification,
    criteriaMet,
    criteriaNotMet,
    criteriaNotAssessed,
    criteriaNotApplicable,
    criteriaSuppressed: [],
    allCriteria: criteria,
  };
}

function classifyByScore(points: number): string {
  if (points >= 10) return "Oncogenic";
  if (points >= 6) return "Likely oncogenic";
  if (points >= 0) return "VUS";
  if (points >= -6) return "Likely benign";
  return "Benign";
}

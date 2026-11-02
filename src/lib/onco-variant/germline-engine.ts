import type { EngineInput } from "./engine-input";
import type { CriterionOutcome, CriterionStrength, InternalComputation, NotAssessedReason } from "./types";

const REQUIRED_DATA_UNAVAILABLE: NotAssessedReason = "required_data_unavailable";
const NOT_ASSESSABLE_PATIENT_DATA = "Requires patient/family-specific clinical, segregation, or de novo confirmation data unavailable from any public database.";
const NOT_ASSESSABLE_GENE_LOOKUP = "Requires a curated gene-level lookup (loss-of-function mechanism, benign-missense rate, or established-pathogenic-residue table) not yet integrated.";
const NOT_ASSESSABLE_FUNCTIONAL_STUDY = "Requires a dedicated functional-study database not yet integrated.";
const NOT_ASSESSABLE_CONTROLS = "Requires a matched case-control cohort database not yet integrated.";
const PS1_INDEPENDENCE_NOTE = "PS1 requires an independently established pathogenic record for a DIFFERENT nucleotide change producing the same amino-acid change. No independent-record lookup is integrated, and the variant's own ClinVar record can never be used to satisfy this criterion (that would be circular).";

const ONCOGENICITY_POINTS: Record<CriterionStrength, number> = {
  "very-strong": 8,
  strong: 4,
  moderate: 2,
  supporting: 1,
  "stand-alone": -8,
};

function outcome(
  code: string,
  strength: CriterionStrength,
  met: boolean | "not_assessed" | "not_applicable",
  rationale: string,
  opts?: { reason?: string; notAssessedReason?: NotAssessedReason },
): CriterionOutcome {
  const isBenign = /^B/.test(code);
  const magnitude = met === true ? Math.abs(ONCOGENICITY_POINTS[strength]) : 0;
  return {
    code,
    strength,
    met,
    points: met === true ? (isBenign ? -magnitude : magnitude) : 0,
    rationale,
    reason: opts?.reason,
    notAssessedReason: met === "not_assessed" ? opts?.notAssessedReason ?? REQUIRED_DATA_UNAVAILABLE : undefined,
  };
}

function suppressed(code: string, strength: CriterionStrength, reason: string): CriterionOutcome {
  return outcome(code, strength, "not_assessed", "Suppressed by local policy — not evaluated for this variant.", { reason, notAssessedReason: REQUIRED_DATA_UNAVAILABLE });
}

function notAssessed(code: string, strength: CriterionStrength, reason: string, notAssessedReason: NotAssessedReason = REQUIRED_DATA_UNAVAILABLE): CriterionOutcome {
  return outcome(code, strength, "not_assessed", "Not assessable from available data.", { reason, notAssessedReason });
}

function notApplicable(code: string, strength: CriterionStrength, reason: string): CriterionOutcome {
  return outcome(code, strength, "not_applicable", "Not applicable to this variant type or evidence context.", { reason });
}

/** Criteria forced to `not_assessed` because they require patient/family-level data no public source provides. */
const PATIENT_LEVEL_FORCED_CODES = ["PS2", "PM3", "PM6", "PP1", "PP4", "BS2", "BS4"];

export type GermlineEngineResult = InternalComputation;

/**
 * Generic ACMG/AMP 2015 germline engine. PP5 and BP6 are permanently disabled (reputable-
 * source recapitulation is not accepted as independent evidence under this engine's
 * policy). PS1 never reads the variant's own record — it is `not_assessed` unless a
 * genuinely independent different-variant record is retrievable, which today it is not.
 */
export function runGermlineEngine(input: EngineInput): GermlineEngineResult {
  const { clinvar, gnomad, computationalPrediction } = input;

  const popFrequency = gnomad.status === "available" ? gnomad.popmaxFrequency ?? gnomad.alleleFrequency : undefined;
  const revel = computationalPrediction.revelScore;
  const alphaMissense = computationalPrediction.alphaMissenseScore;
  const consequence = clinvar.molecularConsequence.join(" ").toLowerCase();
  const isMissenseSnv = input.normalizedVariant.variantType === "SNV" && (/missense/.test(consequence) || Boolean(input.normalizedVariant.proteinChange));
  const isProteinLengthChanging = /in.?frame/i.test(consequence) || /stop.?loss/i.test(consequence);

  const criteriaSuppressed: CriterionOutcome[] = [
    suppressed("PP5", "supporting", "PP5 (reputable-source recapitulation) is permanently disabled by this engine's policy: an external classification is never converted into an internally-computed criterion."),
    suppressed("BP6", "supporting", "BP6 (reputable-source recapitulation) is permanently disabled by this engine's policy: an external classification is never converted into an internally-computed criterion."),
  ];

  const criteria: CriterionOutcome[] = [
    isMissenseSnv
      ? notApplicable("PVS1", "very-strong", "PVS1 applies to qualifying predicted loss-of-function variants, not to a missense SNV.")
      : notAssessed("PVS1", "very-strong", NOT_ASSESSABLE_GENE_LOOKUP),
    notAssessed("PS1", "strong", PS1_INDEPENDENCE_NOTE),
    ...PATIENT_LEVEL_FORCED_CODES.map((code) => notAssessed(code, patientLevelStrength(code), NOT_ASSESSABLE_PATIENT_DATA)),
    notAssessed("PS3", "strong", NOT_ASSESSABLE_FUNCTIONAL_STUDY),
    notAssessed("PS4", "strong", NOT_ASSESSABLE_CONTROLS),
    notAssessed("PM1", "moderate", "Requires germline critical-domain or well-established residue evidence; a somatic hotspot flag is not sufficient for ACMG/AMP PM1."),
    outcome(
      "PM2",
      "supporting",
      popFrequency !== undefined ? popFrequency < 0.0001 : "not_assessed",
      popFrequency !== undefined ? `gnomAD population frequency ${popFrequency} is below the PM2 rarity threshold.` : "gnomAD frequency data was not available.",
      { reason: popFrequency === undefined ? "gnomAD could not be queried, and ClinVar's own frequency field was insufficient for a threshold call." : undefined },
    ),
    isMissenseSnv
      ? notApplicable("PM4", "moderate", "PM4 applies to protein-length-changing in-frame indels or stop-loss variants, not to a missense SNV.")
      : outcome(
          "PM4",
          "moderate",
          isProteinLengthChanging,
          isProteinLengthChanging
            ? "Protein-length-changing consequence (in-frame indel/stop-loss) detected in the molecular consequence list."
            : "No protein-length-changing in-frame indel or stop-loss consequence was found.",
        ),
    notAssessed("PM5", "moderate", NOT_ASSESSABLE_GENE_LOOKUP),
    notAssessed("PP2", "supporting", NOT_ASSESSABLE_GENE_LOOKUP),
    outcome(
      "PP3",
      "supporting",
      revel !== undefined ? revel >= 0.5 : alphaMissense !== undefined ? alphaMissense >= 0.564 : "not_assessed",
      revel !== undefined
        ? `REVEL score ${revel} exceeds the pathogenic-supporting threshold.`
        : alphaMissense !== undefined
          ? `AlphaMissense score ${alphaMissense} exceeds the pathogenic-supporting threshold.`
          : "No computational prediction score was available.",
      { reason: revel === undefined && alphaMissense === undefined ? "Neither REVEL nor AlphaMissense could be retrieved for this variant." : undefined },
    ),
    outcome(
      "BA1",
      "stand-alone",
      popFrequency !== undefined ? popFrequency > 0.05 : "not_assessed",
      popFrequency !== undefined
        ? popFrequency > 0.05
          ? `gnomAD population frequency ${popFrequency} exceeds the BA1 stand-alone-benign threshold (5%).`
          : `gnomAD population frequency ${popFrequency} is below the BA1 stand-alone-benign threshold (5%).`
        : "gnomAD frequency data was not available.",
      { reason: popFrequency === undefined ? "gnomAD could not be queried." : undefined },
    ),
    notAssessed("BS1", "strong", popFrequency === undefined ? "gnomAD could not be queried." : "BS1 requires a disease-specific maximum credible allele frequency; no configured threshold exists for this disease/gene context."),
    notAssessed("BS3", "strong", NOT_ASSESSABLE_FUNCTIONAL_STUDY),
    notAssessed("BP1", "supporting", NOT_ASSESSABLE_GENE_LOOKUP),
    notAssessed("BP2", "supporting", NOT_ASSESSABLE_PATIENT_DATA),
    isMissenseSnv
      ? notApplicable("BP3", "supporting", "BP3 applies to in-frame deletions/insertions in repetitive regions without known function, not to a missense SNV.")
      : notAssessed("BP3", "supporting", NOT_ASSESSABLE_GENE_LOOKUP),
    outcome(
      "BP4",
      "supporting",
      revel !== undefined ? revel < 0.3 : alphaMissense !== undefined ? alphaMissense < 0.34 : "not_assessed",
      revel !== undefined
        ? `REVEL score ${revel} is below the benign-supporting threshold.`
        : alphaMissense !== undefined
          ? `AlphaMissense score ${alphaMissense} is below the benign-supporting threshold.`
          : "No computational prediction score was available.",
      { reason: revel === undefined && alphaMissense === undefined ? "Neither REVEL nor AlphaMissense could be retrieved for this variant." : undefined },
    ),
    notAssessed("BP5", "supporting", NOT_ASSESSABLE_PATIENT_DATA),
    isMissenseSnv
      ? notApplicable("BP7", "supporting", "BP7 applies to synonymous variants with no predicted splice impact, not to a missense SNV.")
      : notAssessed("BP7", "supporting", "Requires a splice-impact predictor not yet integrated."),
  ];

  const allCriteria = [...criteria, ...criteriaSuppressed];
  const criteriaMet = allCriteria.filter((c) => c.met === true);
  const criteriaNotMet = allCriteria.filter((c) => c.met === false);
  const criteriaNotAssessed = criteria.filter((c) => c.met === "not_assessed");
  const criteriaNotApplicable = criteria.filter((c) => c.met === "not_applicable");

  const { verdict, combiningRuleApplied } = applyAcmgCombiningRules(allCriteria);
  const score = allCriteria.reduce((sum, c) => sum + c.points, 0);

  return {
    framework: "ACMG_AMP_2015_categorical",
    status: criteriaNotAssessed.length > 0 ? "incomplete" : "complete",
    score,
    classification: verdict,
    criteriaMet,
    criteriaNotMet,
    criteriaNotAssessed,
    criteriaNotApplicable,
    criteriaSuppressed,
    combiningRuleApplied,
    validationErrors: [],
  };
}

function patientLevelStrength(code: string): CriterionStrength {
  if (code === "BS2" || code === "BS4") return "strong";
  if (code === "PM3" || code === "PM6") return "moderate";
  return "supporting";
}

function countByStrength(criteria: CriterionOutcome[], predicate: (c: CriterionOutcome) => boolean, strength: CriterionStrength) {
  return criteria.filter((c) => predicate(c) && c.strength === strength && c.met === true).length;
}

/** `ACMG_AMP_2015_categorical` combining rule (Richards et al. 2015 point-count table). */
export function applyAcmgCombiningRules(criteria: CriterionOutcome[]): { verdict: string; combiningRuleApplied: string } {
  const isPathogenicCode = (c: CriterionOutcome) => /^P/.test(c.code);
  const isBenignCode = (c: CriterionOutcome) => /^B/.test(c.code);

  const veryStrong = countByStrength(criteria, isPathogenicCode, "very-strong");
  const strong = countByStrength(criteria, isPathogenicCode, "strong");
  const moderate = countByStrength(criteria, isPathogenicCode, "moderate");
  const supporting = countByStrength(criteria, isPathogenicCode, "supporting");

  const standAlone = countByStrength(criteria, isBenignCode, "stand-alone");
  const bStrong = countByStrength(criteria, isBenignCode, "strong");
  const bSupporting = countByStrength(criteria, isBenignCode, "supporting");

  const isPathogenic =
    (veryStrong >= 1 && strong >= 1) ||
    (veryStrong >= 1 && moderate >= 2) ||
    (veryStrong >= 1 && moderate >= 1 && supporting >= 1) ||
    (veryStrong >= 1 && supporting >= 2) ||
    strong >= 2 ||
    (strong >= 1 && moderate >= 3) ||
    (strong >= 1 && moderate >= 2 && supporting >= 2) ||
    (strong >= 1 && moderate >= 1 && supporting >= 4);

  const isLikelyPathogenic =
    (veryStrong >= 1 && moderate >= 1) ||
    (strong >= 1 && moderate >= 1) ||
    (strong >= 1 && supporting >= 2) ||
    moderate >= 3 ||
    (moderate >= 2 && supporting >= 2) ||
    (moderate >= 1 && supporting >= 4);

  const isBenign = standAlone >= 1 || bStrong >= 2;
  const isLikelyBenign = (bStrong >= 1 && bSupporting >= 1) || bSupporting >= 2;

  if (isPathogenic && !isBenign) return { verdict: "Pathogenic", combiningRuleApplied: `${veryStrong} very strong, ${strong} strong, ${moderate} moderate, ${supporting} supporting` };
  if (isBenign && !isPathogenic) return { verdict: "Benign", combiningRuleApplied: `${standAlone} stand-alone, ${bStrong} strong benign` };
  if (isPathogenic && isBenign) return { verdict: "VUS", combiningRuleApplied: "Conflicting pathogenic and benign evidence — defaults to VUS per ACMG/AMP guidance." };
  if (isLikelyPathogenic && !isLikelyBenign) return { verdict: "Likely pathogenic", combiningRuleApplied: `${moderate} moderate, ${supporting} supporting (below full Pathogenic threshold)` };
  if (isLikelyBenign && !isLikelyPathogenic) return { verdict: "Likely benign", combiningRuleApplied: `${bStrong} strong benign, ${bSupporting} supporting benign` };
  return { verdict: "VUS", combiningRuleApplied: "No combining-rule threshold for Pathogenic/Likely pathogenic/Benign/Likely benign was met." };
}

/** `ACMG_AMP_general_Bayesian` combining rule (points ±8/±4/±2/±1; Tavtigian et al. 2018). */
export function applyBayesianCombiningRules(criteria: CriterionOutcome[]): { verdict: string; combiningRuleApplied: string; score: number } {
  const score = criteria.reduce((sum, c) => sum + c.points, 0);
  const verdict = score >= 10 ? "Pathogenic" : score >= 6 ? "Likely pathogenic" : score >= -6 ? "VUS" : score >= -8 ? "Likely benign" : "Benign";
  return { verdict, combiningRuleApplied: `Bayesian point total ${score} (P>=10, LP 6-9, VUS -6..5, LB -7..-8, B<=-9)`, score };
}

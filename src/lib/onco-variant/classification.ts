import { ConflictResolver } from "./conflict.ts";
import type { EngineInput } from "./engine-input";
import { buildGermlineSignificance } from "./germline-external.ts";
import { runGermlineEngine } from "./germline-engine.ts";
import { OncogenicityCompatibilityValidator } from "./oncogenicity-validator.ts";
import { buildOncogenicityExternalAssertions, buildOncogenicityCaveats, selectPrimaryOncogenicityClassification } from "./oncogenicity-external.ts";
import { runOncogenicityEngine } from "./oncogenicity-engine.ts";
import { ClinicalImpactEngine } from "./clinical-impact-engine.ts";
import { OriginAssessmentEngine } from "./origin-engine.ts";
import type { ClassificationResult, InternalComputation, ManualReviewFlag, SourceStatus } from "./types";

export type ClassificationInput = EngineInput;

const CLINICAL_IMPACT_REGISTRY_VERSION = "2024.3";
const UNAVAILABLE_SOURCE_STATUSES = new Set<SourceStatus>(["query_failed", "rate_limited", "permission_denied"]);

function hasUnavailableSource(statuses: SourceStatus[]) {
  return statuses.some((status) => UNAVAILABLE_SOURCE_STATUSES.has(status));
}

/**
 * Thin orchestrator. Computes the four outputs independently and never merges them into
 * a single phrase or a single verdict field — germline significance, somatic
 * oncogenicity, disease-specific somatic clinical impact, and specimen-origin
 * interpretation are always returned, and always displayed, as separate structures.
 *
 * Nothing in this module (or anything it calls) implements or depends on the ClinGen
 * TP53 Variant Curation Expert Panel specification. A TP53 ClinVar expert-panel record
 * can only ever surface as an `externalAssertions[]` entry in the germline or
 * oncogenicity output — it is never converted into PP5, OS1, or any other internally
 * computed criterion.
 */
export function classifyVariant(input: ClassificationInput): ClassificationResult {
  const manualReviewFlags: ManualReviewFlag[] = [];
  const warnings = [...input.normalizedVariant.warnings];

  // --- Germline significance ---
  const germlineInternal = runGermlineEngine(input);
  const germlineSignificance = buildGermlineSignificance(input, germlineInternal);
  if (ConflictResolver.disagrees(germlineInternal.classification, germlineSignificance.externalAssertions)) {
    manualReviewFlags.push({ domain: "germline", reason: "Internal ACMG/AMP computation and the highest-authority external germline assertion disagree." });
  }

  // --- Somatic oncogenicity ---
  const oncogenicityEngineResult = runOncogenicityEngine(input);
  const validation = OncogenicityCompatibilityValidator.validate(oncogenicityEngineResult.allCriteria);
  const oncogenicityInternal: InternalComputation = validation.valid
    ? {
        framework: oncogenicityEngineResult.framework,
        status: oncogenicityEngineResult.status,
        score: oncogenicityEngineResult.score,
        classification: oncogenicityEngineResult.classification,
        criteriaMet: oncogenicityEngineResult.criteriaMet,
        criteriaNotMet: oncogenicityEngineResult.criteriaNotMet,
        criteriaNotAssessed: oncogenicityEngineResult.criteriaNotAssessed,
        criteriaNotApplicable: oncogenicityEngineResult.criteriaNotApplicable,
        criteriaSuppressed: oncogenicityEngineResult.criteriaSuppressed,
        validationErrors: [],
      }
    : {
        framework: oncogenicityEngineResult.framework,
        status: "invalid",
        score: null,
        classification: null,
        criteriaMet: oncogenicityEngineResult.criteriaMet,
        criteriaNotMet: oncogenicityEngineResult.criteriaNotMet,
        criteriaNotAssessed: oncogenicityEngineResult.criteriaNotAssessed,
        criteriaNotApplicable: oncogenicityEngineResult.criteriaNotApplicable,
        criteriaSuppressed: oncogenicityEngineResult.criteriaSuppressed,
        validationErrors: validation.validationErrors,
      };

  const oncogenicityExternalAssertions = buildOncogenicityExternalAssertions(input);
  const oncoSourceUnavailable = hasUnavailableSource([input.clinvar.status, input.oncokb.status, input.cbioportal.status, input.gnomad.status, input.computationalPrediction.status]);
  const { primaryClassification: oncoPrimary, classificationBasis: oncoBasis } = selectPrimaryOncogenicityClassification(oncogenicityExternalAssertions, oncogenicityInternal, oncoSourceUnavailable);
  const somaticOncogenicity = {
    externalAssertions: oncogenicityExternalAssertions,
    primaryClassification: oncoPrimary,
    classificationBasis: oncoBasis,
    internalComputation: oncogenicityInternal,
    caveats: buildOncogenicityCaveats(oncogenicityExternalAssertions, oncogenicityInternal),
  };
  if (oncogenicityInternal.status === "invalid") {
    manualReviewFlags.push({ domain: "oncogenicity", reason: `Internal CGC-VICC computation was rejected as invalid: ${oncogenicityInternal.validationErrors.join("; ")}` });
  }
  if (ConflictResolver.disagrees(oncogenicityInternal.classification, oncogenicityExternalAssertions)) {
    manualReviewFlags.push({ domain: "oncogenicity", reason: "Internal CGC-VICC computation and the highest-authority external oncogenicity assertion disagree." });
  }

  // --- Somatic clinical impact ---
  const somaticClinicalImpact = ClinicalImpactEngine.evaluate(input, somaticOncogenicity.primaryClassification);

  // --- Origin assessment ---
  const originAssessment = OriginAssessmentEngine.evaluate(input.normalizedVariant);
  if (originAssessment.germlineNotExcluded && germlineSignificance.primaryClassification !== "Pathogenic" && germlineSignificance.internalComputation.status === "incomplete") {
    manualReviewFlags.push({ domain: "origin", reason: "Germline origin is not excluded and germline significance could not be fully computed; a constitutional (germline) confirmation test may be warranted before finalizing origin." });
  }

  const sourceStatus: Record<string, SourceStatus> = {
    clinvar: input.clinvar.status,
    oncokb: input.oncokb.status,
    cbioportal: input.cbioportal.status,
    gnomad: input.gnomad.status,
    computationalPrediction: input.computationalPrediction.status,
  };

  return {
    germlineSignificance,
    somaticOncogenicity,
    somaticClinicalImpact,
    originAssessment,
    sourceStatus,
    warnings,
    manualReviewFlags,
    engineMetadata: {
      germlineFramework: germlineInternal.framework,
      oncogenicityFramework: oncogenicityEngineResult.framework,
      clinicalImpactRegistryVersion: CLINICAL_IMPACT_REGISTRY_VERSION,
    },
  };
}

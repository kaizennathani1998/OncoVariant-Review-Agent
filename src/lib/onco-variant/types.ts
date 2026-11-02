export type GenomeBuild = "hg19" | "hg38";

export type SpecimenMaterial =
  | "bone_marrow"
  | "peripheral_blood"
  | "constitutional_tissue"
  | "buccal_swab"
  | "saliva"
  | "cultured_fibroblasts"
  | "solid_tumor_tissue"
  | "unknown";

export type VariantReviewRequest = {
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
  build: GenomeBuild;
  gene?: string;
  proteinChange?: string;
  cancerType?: string;
  disease?: string;
  specimenMaterial?: SpecimenMaterial;
  vaf?: string | number;
};

export type VariantReviewApiRequest = VariantReviewRequest & {
  /** AI narration is intentionally opt-in so deterministic evidence can return immediately. */
  includeAiSummary?: boolean;
  /** Raw upstream payloads are large and are excluded by default, especially for VCF batches. */
  includeRawEvidence?: boolean;
};

export type LiftedCoordinate = {
  chrom: string;
  pos: number;
  build: GenomeBuild;
};

/**
 * NOTE: never derived from, or coupled to, the ClinGen TP53 Variant Curation Expert Panel
 * (VCEP) specification. Nothing in this module is TP53-specific.
 */
export type NormalizedVariant = {
  status: "ok" | "failed";
  reason?: "reference_allele_mismatch" | "invalid_input";
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
  submittedReference?: string;
  expectedReference?: string;
  build: GenomeBuild;
  genomicHgvs: string;
  grch37Hgvs?: string;
  grch38Hgvs?: string;
  hg19?: LiftedCoordinate;
  hg38?: LiftedCoordinate;
  ucscUrls: {
    hg19: string;
    hg38: string;
  };
  liftover: {
    status: "exact" | "estimated" | "unavailable";
    message: string;
  };
  gene?: string;
  proteinChange?: string;
  normalizedProteinChange?: string;
  proteinChangeCandidates: string[];
  submittedProteinChange?: string;
  proteinChangeMatchesInput?: boolean;
  refSeqTranscript?: string;
  canonicalTranscript?: string;
  codingHgvs?: string;
  proteinHgvs?: string;
  strand?: 1 | -1;
  spdi?: string;
  variantType?: "SNV" | "insertion" | "deletion" | "indel" | "unknown";
  cancerType?: string;
  disease?: string;
  specimenMaterial?: SpecimenMaterial;
  vaf?: number;
  warnings: string[];
};

/**
 * Ten-value source-status model. Deliberately distinguishes "reached but empty" (not_found /
 * not_returned) from "could not be reached" (query_failed / rate_limited / permission_denied)
 * from "not applicable to this query" and from ambiguity/conflict/staleness signals.
 */
export type SourceStatus =
  | "available"
  | "not_found"
  | "not_returned"
  | "not_applicable"
  | "query_failed"
  | "rate_limited"
  | "permission_denied"
  | "ambiguous_match"
  | "conflicting"
  | "stale";

export type ClinVarClassification = {
  description?: string;
  reviewStatus?: string;
  lastEvaluated?: string;
  conditions: string[];
};

export type ClinVarResult = {
  status: SourceStatus;
  germlineClassification?: ClinVarClassification;
  somaticClinicalImpact?: ClinVarClassification;
  oncogenicityClassification?: ClinVarClassification;
  variantType?: string;
  cdnaChange?: string;
  molecularConsequence: string[];
  proteinChangeAcrossTranscripts?: string;
  submissionCount?: number;
  variationId?: string;
  vcvAccession?: string;
  gene?: string;
  hgvsNames: string[];
  populationFrequencies: Array<{
    source: string;
    value: string;
  }>;
  crossReferences: Array<{
    db: string;
    id: string;
  }>;
  sourceLink?: string;
  reviewLinks?: Array<{
    label: string;
    url: string;
  }>;
  caveat?: string;
  raw?: unknown;
};

export type OncoKbResult = {
  status: SourceStatus;
  oncogenicity?: string;
  mutationEffect?: string;
  mutationEffectDescription?: string;
  biologicalEffect?: string;
  therapeuticImplications: Array<{
    level?: string;
    fdaLevel?: string;
    drugs: string[];
    alterations: string[];
    cancerType?: string;
    pmids: string[];
    description?: string;
  }>;
  evidenceLevel?: string;
  highestSensitiveLevel?: string;
  highestFdaLevel?: string;
  highestResistanceLevel?: string;
  otherSignificantResistanceLevels: string[];
  highestDiagnosticImplicationLevel?: string;
  highestPrognosticImplicationLevel?: string;
  hotspot?: boolean;
  tumorTypeSummary?: string;
  prognosticSummary?: string;
  diagnosticSummary?: string;
  drugs: string[];
  treatments: Array<Record<string, unknown>>;
  diagnosticImplications: Array<Record<string, unknown>>;
  prognosticImplications: Array<Record<string, unknown>>;
  citations: string[];
  sourceLink?: string;
  reviewLinks?: Array<{
    label: string;
    url: string;
  }>;
  caveat?: string;
  raw?: unknown;
};

export type CbioPortalResult = {
  status: SourceStatus;
  matchingStudies: Array<{
    studyId: string;
    name: string;
    cancerType?: string;
    sampleCount?: number;
    mutationCount?: number;
    matchingProteinChanges?: string[];
    approximateMatches?: boolean;
    link?: string;
    mutationFrequency?: string;
    sampleLevelEvidence?: Array<{
      sampleId: string;
      mutationStatus?: string;
      vaf?: number;
    }>;
  }>;
  tumorTypes: string[];
  sampleCount?: number;
  mutationCount?: number;
  matchingProteinChanges: string[];
  queriedStudies: Array<{
    studyId: string;
    name?: string;
    molecularProfileId?: string;
    sampleListId?: string;
    status: "queried" | "skipped" | "error";
    message?: string;
  }>;
  sourceLink?: string;
  reviewLinks?: Array<{
    label: string;
    url: string;
  }>;
  caveat?: string;
  raw?: unknown;
};

export type GnomadResult = {
  status: SourceStatus;
  database?: "gnomAD";
  release?: string;
  dataset?: string;
  alleleFrequency?: number;
  alleleCount?: number;
  alleleNumber?: number;
  homozygoteCount?: number;
  popmaxFrequency?: number;
  popmaxPopulation?: string;
  filteringAlleleFrequency?: number;
  coverage?: string;
  qualityStatus?: string;
  populations?: Array<{
    population: string;
    alleleCount?: number;
    alleleNumber?: number;
    alleleFrequency?: number;
  }>;
  rsIds: string[];
  sourceLink?: string;
  reviewLinks?: Array<{ label: string; url: string }>;
  caveat?: string;
  raw?: unknown;
};

export type ComputationalPredictionResult = {
  status: SourceStatus;
  revelScore?: number;
  alphaMissenseScore?: number;
  alphaMissensePrediction?: string;
  predictor?: "REVEL" | "AlphaMissense";
  sourceLink?: string;
  reviewLinks?: Array<{ label: string; url: string }>;
  caveat?: string;
  raw?: unknown;
};

export type CivicResult = {
  status: SourceStatus;
  molecularProfiles: Array<{
    id?: string;
    name: string;
    link?: string;
    evidenceItemCount?: number;
    assertionCount?: number;
  }>;
  evidenceItems: Array<{
    id?: string;
    clinicalSignificance?: string;
    evidenceLevel?: string;
    evidenceType?: string;
    disease?: string;
    therapy?: string;
    source?: string;
  }>;
  sourceLink?: string;
  reviewLinks?: Array<{ label: string; url: string }>;
  caveat?: string;
  raw?: unknown;
};

export type CosmicResult = {
  status: SourceStatus;
  matches: Array<{
    gene?: string;
    mutation?: string;
    disease?: string;
    sampleCount?: number;
    source?: string;
  }>;
  sourceLink?: string;
  reviewLinks?: Array<{ label: string; url: string }>;
  caveat?: string;
  raw?: unknown;
};

export type GenieResult = CbioPortalResult & {
  registry: "AACR_GENIE";
};

export type ImportPackageStatus = "imported" | "partial" | "unavailable" | "user_input_required";

export type PracticalImportPackage = {
  vepAnnotation: ImportPackageStatus;
  clinvarTracks: ImportPackageStatus;
  gnomadPopulation: ImportPackageStatus;
  oncokb: ImportPackageStatus;
  cbioportal: ImportPackageStatus;
  aacrGenie: ImportPackageStatus;
  civic: ImportPackageStatus;
  cosmic: ImportPackageStatus;
  diseaseOntology: ImportPackageStatus;
  guidelineRegistry: ImportPackageStatus;
  specimenContext: ImportPackageStatus;
  treatmentContext: ImportPackageStatus;
  diagnosticContext: ImportPackageStatus;
  caveats: string[];
};

export type CriterionStrength = "very-strong" | "strong" | "moderate" | "supporting" | "stand-alone";

/** Reason taxonomy for a `not_assessed` criterion outcome. */
export type NotAssessedReason = "required_data_unavailable" | "evidence_available_but_threshold_not_satisfied";

export type CriterionOutcome = {
  code: string;
  strength: CriterionStrength;
  met: boolean | "not_assessed" | "not_applicable";
  points: number;
  rationale: string;
  reason?: string;
  notAssessedReason?: NotAssessedReason;
};

/**
 * Local authority ranking used only to pick which external assertion is surfaced as
 * `primaryClassification` when more than one exists. This is our own editorial policy,
 * not a rule from any single guideline body.
 */
export type ExternalAssertionAuthority =
  | "practice_guideline"
  | "expert_panel"
  | "multiple_concordant"
  | "single_with_criteria"
  | "single_without_criteria"
  | "unspecified";

/**
 * A classification asserted by an external database/curation body (e.g. a ClinVar
 * germline or oncogenicity submission, an OncoKB oncogenicity label). Always kept
 * structurally separate from `internalComputation` and NEVER auto-converted into an
 * ACMG/AMP or CGC-VICC criterion. This is where a TP53 ClinGen expert-panel ClinVar
 * record is allowed to appear — as data, never as internally-computed logic.
 */
export type ExternalAssertion = {
  source: string;
  track: "germline" | "oncogenicity";
  classification: string;
  reviewStatus?: string;
  conditions: string[];
  authority: ExternalAssertionAuthority;
  lastEvaluated?: string;
  sourceLink?: string;
};

export type InternalComputationStatus = "complete" | "incomplete" | "invalid";

export type InternalComputation = {
  framework: string;
  status: InternalComputationStatus;
  score: number | null;
  classification: string | null;
  criteriaMet: CriterionOutcome[];
  criteriaNotMet: CriterionOutcome[];
  criteriaNotAssessed: CriterionOutcome[];
  criteriaNotApplicable: CriterionOutcome[];
  criteriaSuppressed: CriterionOutcome[];
  combiningRuleApplied?: string;
  validationErrors: string[];
};

export type ClassificationBasis = "internal_computation" | "external_curated_assertion";

export type GermlineSignificance = {
  externalAssertions: ExternalAssertion[];
  primaryClassification: string;
  classificationBasis: ClassificationBasis;
  internalComputation: InternalComputation;
  caveats: string[];
};

export type SomaticOncogenicity = {
  externalAssertions: ExternalAssertion[];
  primaryClassification: string;
  classificationBasis: ClassificationBasis;
  internalComputation: InternalComputation;
  caveats: string[];
};

export type DiseaseMatchCategory = "exact" | "subtype" | "parent" | "histology_agnostic" | "cross_tumor" | "unrelated" | "ambiguous";

export type ClinicalImpactAxisStatus = "tier_assigned" | "applicability_not_fully_assessable" | "not_computed";
export type ClinicalImpactApplicabilityStatus = "complete" | "context_incomplete" | "not_fully_assessable" | "source_unavailable";

export type ClinicalImpactAxis = {
  axis: "therapeutic" | "diagnostic" | "prognostic";
  status: ClinicalImpactAxisStatus;
  tier?: "Tier_I" | "Tier_II" | "Tier_III" | "Tier_IV";
  evidenceLevel?: string;
  reason?: string;
  implication?: string;
  sourceDisease?: string;
  submittedDisease?: string;
  guidelineOrRegulatorySource?: string;
  guidelineVersion?: string;
  requiredConditions?: string[];
  conditionsMet?: string[];
  conditionsMissing?: string[];
  applicabilityStatus?: ClinicalImpactApplicabilityStatus;
  missingRequirements?: string[];
  matchedRule?: string;
  matchedRuleVersion?: string;
  diseaseMatch?: DiseaseMatchCategory;
};

export type SomaticClinicalImpact = {
  disease?: {
    submitted?: string;
    normalizedName?: string;
    ontologyId?: string;
    mappingConfidence?: "high" | "medium" | "low" | "none";
  };
  axes: ClinicalImpactAxis[];
  caveats: string[];
};

export type SpecimenRole =
  | "disease_specimen"
  | "constitutional_germline_test"
  | "unknown";

export type OriginConclusion =
  | "presumed_disease_associated_somatic"
  | "presumed_constitutional_germline"
  | "somatic_origin_indeterminate";

export type OriginAssessment = {
  specimenMaterial?: SpecimenMaterial;
  specimenRole: SpecimenRole;
  conclusion: OriginConclusion;
  germlineNotExcluded: boolean;
  clonalHematopoiesisPossible: boolean;
  copyNumberOrLohPossible: boolean;
  caveats: string[];
};

export type ManualReviewFlag = {
  domain: "germline" | "oncogenicity" | "clinical_impact" | "origin";
  reason: string;
};

export type ClassificationResult = {
  germlineSignificance: GermlineSignificance;
  somaticOncogenicity: SomaticOncogenicity;
  somaticClinicalImpact: SomaticClinicalImpact;
  originAssessment: OriginAssessment;
  sourceStatus: Record<string, SourceStatus>;
  warnings: string[];
  manualReviewFlags: ManualReviewFlag[];
  engineMetadata: {
    germlineFramework: string;
    oncogenicityFramework: string;
    clinicalImpactRegistryVersion: string;
  };
};

export type VariantReviewResponse = {
  normalizedVariant: NormalizedVariant;
  ucscUrl: string;
  ucscUrls: {
    hg19: string;
    hg38: string;
  };
  clinvar: ClinVarResult;
  oncokb: OncoKbResult;
  cbioportal: CbioPortalResult;
  aacrGenie: GenieResult;
  gnomad: GnomadResult;
  computationalPrediction: ComputationalPredictionResult;
  civic: CivicResult;
  cosmic: CosmicResult;
  practicalImportPackage: PracticalImportPackage;
  classification: ClassificationResult;
  aiSummary: string;
  aiSummaryStatus: "generated" | "deterministic" | "not_requested";
  queryMetadata: {
    totalMs: number;
    normalizationMs: number;
    evidenceMs: number;
    classificationMs: number;
    aiSummaryMs: number;
    sourceMs: Record<string, number>;
    generatedAt: string;
  };
};

export type VariantReviewCore = Omit<VariantReviewResponse, "aiSummary" | "aiSummaryStatus" | "queryMetadata">;

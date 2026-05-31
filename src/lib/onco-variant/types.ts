export type GenomeBuild = "hg19" | "hg38";

export type VariantReviewRequest = {
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
  build: GenomeBuild;
  gene?: string;
  proteinChange?: string;
  cancerType?: string;
};

export type NormalizedVariant = {
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
  build: GenomeBuild;
  genomicHgvs: string;
  gene?: string;
  proteinChange?: string;
  cancerType?: string;
};

export type SourceStatus = "live" | "mock" | "error" | "missing-token" | "not-found";

export type ClinVarResult = {
  status: SourceStatus;
  clinicalSignificance?: string;
  diseaseCondition?: string;
  reviewStatus?: string;
  variationId?: string;
  vcvAccession?: string;
  gene?: string;
  hgvsNames: string[];
  sourceLink?: string;
  caveat?: string;
  raw?: unknown;
};

export type OncoKbResult = {
  status: SourceStatus;
  oncogenicity?: string;
  mutationEffect?: string;
  biologicalEffect?: string;
  therapeuticImplications: Array<{
    level?: string;
    drugs: string[];
    alteration?: string;
    cancerType?: string;
  }>;
  evidenceLevel?: string;
  drugs: string[];
  sourceLink?: string;
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
    mutationFrequency?: string;
  }>;
  tumorTypes: string[];
  sampleCount?: number;
  sourceLink?: string;
  caveat?: string;
  raw?: unknown;
};

export type VariantReviewResponse = {
  normalizedVariant: NormalizedVariant;
  ucscUrl: string;
  clinvar: ClinVarResult;
  oncokb: OncoKbResult;
  cbioportal: CbioPortalResult;
  aiSummary: string;
};


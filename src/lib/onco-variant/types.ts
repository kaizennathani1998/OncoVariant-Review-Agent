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
  cancerType?: string;
};

export type LiftedCoordinate = {
  chrom: string;
  pos: number;
  build: GenomeBuild;
};

export type SourceStatus = "live" | "mock" | "error" | "unavailable" | "missing-token" | "not-found";

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
  highestDiagnosticImplicationLevel?: string;
  highestPrognosticImplicationLevel?: string;
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
  aiSummary: string;
};

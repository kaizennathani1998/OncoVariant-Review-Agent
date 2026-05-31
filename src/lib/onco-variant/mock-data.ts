import type { CbioPortalResult, ClinVarResult, OncoKbResult } from "./types";

export const mockClinVar: ClinVarResult = {
  status: "mock",
  clinicalSignificance: "Mock: source unavailable",
  diseaseCondition: "Mock: unavailable",
  reviewStatus: "Mock: unavailable",
  variationId: "Mock",
  vcvAccession: "Mock",
  gene: "Mock",
  hgvsNames: ["Mock"],
  sourceLink: "https://www.ncbi.nlm.nih.gov/clinvar/",
  caveat: "Mock fallback data shown because ClinVar could not be queried or parsed.",
};

export const mockOncoKb: OncoKbResult = {
  status: "mock",
  oncogenicity: "Mock: unavailable",
  mutationEffect: "Mock: unavailable",
  biologicalEffect: "Mock: unavailable",
  therapeuticImplications: [],
  evidenceLevel: "Mock: unavailable",
  drugs: [],
  sourceLink: "https://www.oncokb.org/",
  caveat: "Mock fallback data shown because OncoKB was unavailable.",
};

export const mockCbioPortal: CbioPortalResult = {
  status: "mock",
  matchingStudies: [],
  tumorTypes: [],
  sourceLink: "https://www.cbioportal.org/",
  caveat: "Mock fallback data shown because cBioPortal was unavailable.",
};


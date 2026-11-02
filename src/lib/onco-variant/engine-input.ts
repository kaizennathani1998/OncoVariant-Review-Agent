import type { CbioPortalResult, ClinVarResult, ComputationalPredictionResult, GnomadResult, NormalizedVariant, OncoKbResult } from "./types";

/** Shared read-only input contract passed to every classification engine. */
export type EngineInput = {
  normalizedVariant: NormalizedVariant;
  clinvar: ClinVarResult;
  oncokb: OncoKbResult;
  cbioportal: CbioPortalResult;
  gnomad: GnomadResult;
  computationalPrediction: ComputationalPredictionResult;
};

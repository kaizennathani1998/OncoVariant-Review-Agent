export function mapReferenceGenome(build: "hg19" | "hg38"): "GRCh37" | "GRCh38";
export function stripProteinPrefix(value?: string): string;
export function normalizeProteinChange(value?: string): string;
export function proteinChangeCandidates(value?: string): string[];
export function isProteinMatch(observed?: string, candidates?: string[]): { matched: boolean; approximate: boolean };
export function parseOncoKbResponse(raw?: Record<string, unknown>): {
  oncogenicity?: string;
  mutationEffect?: string;
  mutationEffectDescription?: string;
  biologicalEffect?: string;
  highestSensitiveLevel?: string;
  highestFdaLevel?: string;
  highestDiagnosticImplicationLevel?: string;
  highestPrognosticImplicationLevel?: string;
  therapeuticImplications: Array<{
    drugs: string[];
    level?: string;
    fdaLevel?: string;
    cancerType?: string;
    alterations: string[];
    pmids: string[];
    description?: string;
  }>;
  evidenceLevel?: string;
  drugs: string[];
  treatments: Array<Record<string, unknown>>;
  diagnosticImplications: Array<Record<string, unknown>>;
  prognosticImplications: Array<Record<string, unknown>>;
  citations: string[];
};


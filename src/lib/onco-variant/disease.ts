import type { DiseaseMatchCategory } from "./types";

export type DiseaseConcept = {
  normalizedName: string;
  ontologyId: string;
  parentDiseases: string[];
  subtypes: string[];
};

/**
 * Small curated static alias table. Deliberately generic (not gene-specific, not
 * TP53-specific) — it exists purely to normalize free-text disease/cancer-type input
 * into a canonical concept so the clinical-impact and origin engines can key off of it.
 */
const DISEASE_ALIASES: Array<{ aliases: string[]; concept: DiseaseConcept }> = [
  {
    aliases: ["aml", "acute myeloid leukemia", "acute myelogenous leukemia", "acute myeloid leukaemia"],
    concept: { normalizedName: "Acute myeloid leukemia", ontologyId: "NCIT:C3171", parentDiseases: ["Myeloid neoplasm", "Hematologic malignancy"], subtypes: [] },
  },
  {
    aliases: ["mds", "myelodysplastic syndrome", "myelodysplastic syndromes"],
    concept: { normalizedName: "Myelodysplastic syndrome", ontologyId: "NCIT:C3247", parentDiseases: ["Myeloid neoplasm", "Hematologic malignancy"], subtypes: [] },
  },
  {
    aliases: ["cll", "chronic lymphocytic leukemia"],
    concept: { normalizedName: "Chronic lymphocytic leukemia", ontologyId: "NCIT:C3163", parentDiseases: ["Lymphoid neoplasm", "Hematologic malignancy"], subtypes: [] },
  },
  {
    aliases: ["breast cancer", "breast carcinoma", "breast adenocarcinoma"],
    concept: { normalizedName: "Breast cancer", ontologyId: "NCIT:C4872", parentDiseases: ["Solid tumor", "Carcinoma"], subtypes: ["Triple-negative breast cancer", "HER2-positive breast cancer"] },
  },
  {
    aliases: ["colorectal cancer", "colon cancer", "crc"],
    concept: { normalizedName: "Colorectal cancer", ontologyId: "NCIT:C2955", parentDiseases: ["Solid tumor", "Carcinoma"], subtypes: [] },
  },
  {
    aliases: ["lung adenocarcinoma", "nsclc", "non-small cell lung cancer"],
    concept: { normalizedName: "Non-small cell lung cancer", ontologyId: "NCIT:C2926", parentDiseases: ["Solid tumor", "Carcinoma"], subtypes: ["Lung adenocarcinoma"] },
  },
  {
    aliases: ["li-fraumeni syndrome", "li fraumeni syndrome"],
    concept: { normalizedName: "Li-Fraumeni syndrome", ontologyId: "NCIT:C3247_LFS", parentDiseases: ["Hereditary cancer-predisposition syndrome"], subtypes: [] },
  },
];

export function normalizeDisease(input?: string): DiseaseConcept | undefined {
  const cleaned = input?.trim().toLowerCase();
  if (!cleaned) return undefined;
  const match = DISEASE_ALIASES.find((entry) => entry.aliases.includes(cleaned));
  if (match) return match.concept;
  // Unrecognized free text is still treated as a disease concept of its own (unmapped),
  // so downstream matching can at least attempt an exact string comparison.
  return { normalizedName: input!.trim(), ontologyId: "", parentDiseases: [], subtypes: [] };
}

/**
 * Classifies the relationship between a disease reported by an external evidence source
 * and the disease submitted with the case. Never assumes "no disease submitted" means
 * "matches everything" — that case is `ambiguous`.
 */
export function matchDisease(sourceDisease: string | undefined, submittedDisease: string | undefined): DiseaseMatchCategory {
  const source = normalizeDisease(sourceDisease);
  const submitted = normalizeDisease(submittedDisease);
  if (!submitted) return "ambiguous";
  if (!source) return "ambiguous";

  if (source.normalizedName.toLowerCase() === submitted.normalizedName.toLowerCase()) return "exact";
  if (submitted.parentDiseases.map((p) => p.toLowerCase()).includes(source.normalizedName.toLowerCase())) return "subtype";
  if (source.parentDiseases.map((p) => p.toLowerCase()).includes(submitted.normalizedName.toLowerCase())) return "parent";
  if (submitted.subtypes.map((s) => s.toLowerCase()).includes(source.normalizedName.toLowerCase())) return "subtype";

  const sharedParent = source.parentDiseases.some((p) => submitted.parentDiseases.map((sp) => sp.toLowerCase()).includes(p.toLowerCase()));
  if (sharedParent) return "histology_agnostic";

  return "cross_tumor";
}

export function diseaseMappingConfidence(concept: DiseaseConcept | undefined): "high" | "medium" | "low" | "none" {
  if (!concept) return "none";
  return concept.ontologyId ? "high" : "low";
}

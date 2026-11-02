import { inferSpecimenRole } from "./specimen.ts";
import type { NormalizedVariant, OriginAssessment, OriginConclusion, SpecimenMaterial, SpecimenRole } from "./types";

type OriginLookupEntry = {
  conclusion: OriginConclusion;
  germlineNotExcluded: boolean;
  clonalHematopoiesisPossible: boolean;
  copyNumberOrLohPossible: boolean;
};

/**
 * Pure lookup table keyed on (specimenRole, isHematologicDisease). VAF is deliberately
 * never a key here — it only ever contributes a caveat/warning on top of the looked-up
 * conclusion, never changes the conclusion itself.
 */
const ORIGIN_TABLE: Record<SpecimenRole, Record<"hematologic" | "non_hematologic" | "unknown_disease", OriginLookupEntry>> = {
  disease_specimen: {
    hematologic: {
      conclusion: "presumed_disease_associated_somatic",
      germlineNotExcluded: true,
      clonalHematopoiesisPossible: true,
      copyNumberOrLohPossible: true,
    },
    non_hematologic: {
      conclusion: "presumed_disease_associated_somatic",
      germlineNotExcluded: true,
      clonalHematopoiesisPossible: false,
      copyNumberOrLohPossible: true,
    },
    unknown_disease: {
      conclusion: "somatic_origin_indeterminate",
      germlineNotExcluded: true,
      clonalHematopoiesisPossible: true,
      copyNumberOrLohPossible: true,
    },
  },
  constitutional_germline_test: {
    hematologic: {
      conclusion: "presumed_constitutional_germline",
      germlineNotExcluded: false,
      clonalHematopoiesisPossible: false,
      copyNumberOrLohPossible: false,
    },
    non_hematologic: {
      conclusion: "presumed_constitutional_germline",
      germlineNotExcluded: false,
      clonalHematopoiesisPossible: false,
      copyNumberOrLohPossible: false,
    },
    unknown_disease: {
      conclusion: "presumed_constitutional_germline",
      germlineNotExcluded: false,
      clonalHematopoiesisPossible: false,
      copyNumberOrLohPossible: false,
    },
  },
  unknown: {
    hematologic: {
      conclusion: "somatic_origin_indeterminate",
      germlineNotExcluded: true,
      clonalHematopoiesisPossible: true,
      copyNumberOrLohPossible: true,
    },
    non_hematologic: {
      conclusion: "somatic_origin_indeterminate",
      germlineNotExcluded: true,
      clonalHematopoiesisPossible: false,
      copyNumberOrLohPossible: true,
    },
    unknown_disease: {
      conclusion: "somatic_origin_indeterminate",
      germlineNotExcluded: true,
      clonalHematopoiesisPossible: false,
      copyNumberOrLohPossible: false,
    },
  },
};

function diseaseBucket(disease: string | undefined): "hematologic" | "non_hematologic" | "unknown_disease" {
  if (!disease) return "unknown_disease";
  return /leukemia|leukaemia|lymphoma|myeloma|myelodysplastic|mds|aml|cll|cml|mpn|myeloproliferative/i.test(disease) ? "hematologic" : "non_hematologic";
}

export const OriginAssessmentEngine = {
  evaluate(variant: NormalizedVariant): OriginAssessment {
    const disease = variant.disease ?? variant.cancerType;
    const specimenMaterial: SpecimenMaterial | undefined = variant.specimenMaterial;
    const specimenRole = inferSpecimenRole(disease, specimenMaterial);
    const entry = ORIGIN_TABLE[specimenRole][diseaseBucket(disease)];

    const caveats: string[] = [];
    if (!specimenMaterial || specimenMaterial === "unknown") {
      caveats.push("No specimen material was submitted; origin cannot be meaningfully assessed beyond an indeterminate default.");
    }
    if (variant.vaf !== undefined) {
      if (entry.clonalHematopoiesisPossible && variant.vaf < 0.4) {
        caveats.push(`Submitted VAF (${(variant.vaf * 100).toFixed(0)}%) is compatible with either a subclonal disease-associated somatic event or clonal hematopoiesis; VAF alone does not resolve this and does not change the origin conclusion.`);
      } else if (variant.vaf >= 0.4 && variant.vaf <= 0.6) {
        caveats.push(`Submitted VAF (${(variant.vaf * 100).toFixed(0)}%) is in the range consistent with either a heterozygous constitutional variant, a somatic copy-number/LOH event, or a near-clonal somatic event; VAF alone does not resolve this and does not change the origin conclusion.`);
      }
    } else {
      caveats.push("No VAF was submitted; VAF-based caveats about subclonal/clonal or heterozygous-range signal could not be added.");
    }

    return {
      specimenMaterial,
      specimenRole,
      conclusion: entry.conclusion,
      germlineNotExcluded: entry.germlineNotExcluded,
      clonalHematopoiesisPossible: entry.clonalHematopoiesisPossible,
      copyNumberOrLohPossible: entry.copyNumberOrLohPossible,
      caveats,
    };
  },
};

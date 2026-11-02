import type { SpecimenMaterial, SpecimenRole } from "./types";

/**
 * Infers the role a specimen plays in interpretation, given the disease context and the
 * material the specimen was drawn from. Never assumes peripheral blood = a normal/germline
 * comparator sample — for a hematologic malignancy, peripheral blood is itself commonly
 * disease-involved (circulating blasts, clonal hematopoiesis), so it is treated the same
 * as bone marrow when a hematologic disease is present.
 */
export function inferSpecimenRole(disease: string | undefined, specimenMaterial: SpecimenMaterial | undefined): SpecimenRole {
  if (!specimenMaterial || specimenMaterial === "unknown") return "unknown";

  const hematologicDisease = isHematologicDisease(disease);

  switch (specimenMaterial) {
    case "bone_marrow":
      return "disease_specimen";
    case "peripheral_blood":
      return hematologicDisease ? "disease_specimen" : "unknown";
    case "solid_tumor_tissue":
      return "disease_specimen";
    case "constitutional_tissue":
    case "buccal_swab":
    case "saliva":
    case "cultured_fibroblasts":
      return "constitutional_germline_test";
    default:
      return "unknown";
  }
}

function isHematologicDisease(disease: string | undefined): boolean {
  const value = disease?.trim().toLowerCase();
  if (!value) return false;
  return /leukemia|leukaemia|lymphoma|myeloma|myelodysplastic|mds|aml|cll|cml|mpn|myeloproliferative/.test(value);
}

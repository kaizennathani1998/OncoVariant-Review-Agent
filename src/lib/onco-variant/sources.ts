import { mockCbioPortal, mockClinVar, mockOncoKb } from "./mock-data";
import type { CbioPortalResult, ClinVarResult, NormalizedVariant, OncoKbResult } from "./types";

const JSON_HEADERS = { Accept: "application/json" };

export async function queryClinVar(variant: NormalizedVariant): Promise<ClinVarResult> {
  try {
    const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
    searchUrl.searchParams.set("db", "clinvar");
    searchUrl.searchParams.set("retmode", "json");
    searchUrl.searchParams.set("retmax", "5");
    searchUrl.searchParams.set("term", [variant.gene ? `${variant.gene}[gene]` : undefined, `${variant.chrom.replace(/^chr/i, "")}[chr]`, `${variant.pos}[chrpos]`].filter(Boolean).join(" AND "));
    if (process.env.NCBI_API_KEY) searchUrl.searchParams.set("api_key", process.env.NCBI_API_KEY);

    const search = await fetchJson<{ esearchresult?: { idlist?: string[] } }>(searchUrl);
    const id = search.esearchresult?.idlist?.[0];
    if (!id) {
      return {
        status: "not-found",
        gene: variant.gene,
        hgvsNames: [variant.genomicHgvs],
        sourceLink: "https://www.ncbi.nlm.nih.gov/clinvar/",
        caveat: "No exact ClinVar record was found for the submitted search terms.",
      };
    }

    const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
    summaryUrl.searchParams.set("db", "clinvar");
    summaryUrl.searchParams.set("retmode", "json");
    summaryUrl.searchParams.set("id", id);
    if (process.env.NCBI_API_KEY) summaryUrl.searchParams.set("api_key", process.env.NCBI_API_KEY);
    const summary = await fetchJson<Record<string, unknown>>(summaryUrl);
    const record = (summary.result as Record<string, unknown> | undefined)?.[id] as Record<string, unknown> | undefined;

    return {
      status: "live",
      clinicalSignificance: readString(record, ["clinical_significance", "germline_classification", "clinicalsignificance"]),
      diseaseCondition: readString(record, ["trait_set", "traitset", "condition"]),
      reviewStatus: readString(record, ["review_status", "reviewstatus"]),
      variationId: readString(record, ["variation_id", "variationid", "uid"]) ?? id,
      vcvAccession: readString(record, ["accession", "vcv", "variation_set_name"]),
      gene: variant.gene ?? readString(record, ["gene_sort", "genesymbol"]),
      hgvsNames: [variant.genomicHgvs],
      sourceLink: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${id}/`,
      caveat: "ClinVar E-utilities fields vary by record; verify against the linked source.",
      raw: record,
    };
  } catch (error) {
    return { ...mockClinVar, caveat: `Mock fallback data shown because ClinVar query failed: ${errorMessage(error)}` };
  }
}

export async function queryOncoKb(variant: NormalizedVariant): Promise<OncoKbResult> {
  const token = process.env.ONCOKB_API_TOKEN;
  if (!token) {
    return {
      status: "missing-token",
      therapeuticImplications: [],
      drugs: [],
      sourceLink: "https://www.oncokb.org/",
      caveat: "ONCOKB_API_TOKEN is missing. Add it to .env.local to enable live OncoKB annotation.",
    };
  }
  if (!variant.gene || !variant.proteinChange) {
    return {
      status: "not-found",
      therapeuticImplications: [],
      drugs: [],
      sourceLink: "https://www.oncokb.org/",
      caveat: "OncoKB protein-change annotation requires a gene symbol and protein alteration.",
    };
  }
  try {
    const url = new URL("https://www.oncokb.org/api/v1/annotate/mutations/byProteinChange");
    url.searchParams.set("hugoSymbol", variant.gene);
    url.searchParams.set("alteration", variant.proteinChange.replace(/^p\./i, ""));
    if (variant.cancerType) url.searchParams.set("tumorType", variant.cancerType);
    const data = await fetchJson<Record<string, unknown>>(url, { headers: { Authorization: `Bearer ${token}` } });
    return {
      status: "live",
      oncogenicity: readString(data, ["oncogenic", "oncogenicity"]),
      mutationEffect: readString(data, ["mutationEffect", "effect"]),
      biologicalEffect: readString(data, ["biologicalEffect", "variantEffect"]),
      therapeuticImplications: [],
      drugs: [],
      sourceLink: `https://www.oncokb.org/gene/${variant.gene}`,
      caveat: "OncoKB annotations depend on token access and tumor type mapping.",
      raw: data,
    };
  } catch (error) {
    return { ...mockOncoKb, caveat: `Mock fallback data shown because OncoKB query failed: ${errorMessage(error)}` };
  }
}

export async function queryCbioPortal(variant: NormalizedVariant): Promise<CbioPortalResult> {
  try {
    const studiesUrl = new URL("https://www.cbioportal.org/api/studies");
    studiesUrl.searchParams.set("projection", "SUMMARY");
    const studies = await fetchJson<Array<Record<string, unknown>>>(studiesUrl);
    const needle = variant.cancerType?.toLowerCase();
    const matching = studies.filter((study) => !needle || [readString(study, ["studyId"]), readString(study, ["name"]), readString(study, ["description"]), readString(study, ["cancerTypeId"])].join(" ").toLowerCase().includes(needle)).slice(0, 8);
    const mapped = matching.map((study) => ({
      studyId: readString(study, ["studyId"]) ?? "unknown",
      name: readString(study, ["name"]) ?? "Unnamed study",
      cancerType: readString(study, ["cancerTypeId"]),
      sampleCount: readNumber(study, ["allSampleCount", "sequencedSampleCount", "sampleCount"]),
      mutationFrequency: variant.gene ? "Exact variant frequency requires study molecular profile mutation fetch." : undefined,
    }));
    return {
      status: mapped.length ? "live" : "not-found",
      matchingStudies: mapped,
      tumorTypes: Array.from(new Set(mapped.map((study) => study.cancerType).filter(Boolean))) as string[],
      sampleCount: mapped.reduce((sum, study) => sum + (study.sampleCount ?? 0), 0) || undefined,
      sourceLink: `https://www.cbioportal.org/results/mutations?case_set_id=all&Action=Submit${variant.gene ? `&gene_list=${encodeURIComponent(variant.gene)}` : ""}`,
      caveat: mapped.length ? "This MVP lists matching public studies; exact variant-level frequency may require per-study molecular profile queries." : "No matching public cBioPortal studies were found.",
      raw: matching,
    };
  } catch (error) {
    return { ...mockCbioPortal, caveat: `Mock fallback data shown because cBioPortal query failed: ${errorMessage(error)}` };
  }
}

async function fetchJson<T>(input: URL, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(input, { ...init, headers: { ...JSON_HEADERS, ...init?.headers }, signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

function readString(record: unknown, keys: string[]) {
  if (!record || typeof record !== "object") return undefined;
  const source = record as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
    if (Array.isArray(value) && value.length) return value.map(String).join("; ");
  }
  return undefined;
}

function readNumber(record: unknown, keys: string[]) {
  const value = readString(record, keys);
  return value ? Number(value) || undefined : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}


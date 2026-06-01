import type { CbioPortalResult, ClinVarResult, NormalizedVariant, OncoKbResult } from "./types";
import { isProteinMatch, mapReferenceGenome, parseOncoKbResponse } from "./parsers.mjs";

const JSON_HEADERS = { Accept: "application/json" };
const CBIO_BASE = "https://www.cbioportal.org";
const ENTREZ_GENE_IDS: Record<string, number> = {
  NPM1: 4869,
  CSF3R: 1441,
  TP53: 7157,
};

export async function queryClinVar(variant: NormalizedVariant): Promise<ClinVarResult> {
  const clinvarSearchLink = clinvarVariantSearchLink(variant);
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
        sourceLink: clinvarSearchLink,
        reviewLinks: [{ label: "ClinVar search for submitted variant", url: clinvarSearchLink }],
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
      reviewLinks: [
        { label: "ClinVar variation page", url: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${id}/` },
        { label: "ClinVar search for submitted variant", url: clinvarSearchLink },
      ],
      caveat: "ClinVar E-utilities fields vary by record; verify against the linked source.",
      raw: record,
    };
  } catch (error) {
    return {
      status: "unavailable",
      gene: variant.gene,
      hgvsNames: [variant.genomicHgvs],
      sourceLink: clinvarSearchLink,
      reviewLinks: [{ label: "ClinVar search for submitted variant", url: clinvarSearchLink }],
      caveat: `ClinVar could not be queried at this time: ${errorMessage(error)}`,
    };
  }
}

export async function queryOncoKb(variant: NormalizedVariant): Promise<OncoKbResult> {
  const token = process.env.ONCOKB_API_TOKEN;
  if (!token) {
    return {
      status: "missing-token",
      therapeuticImplications: [],
      drugs: [],
      treatments: [],
      diagnosticImplications: [],
      prognosticImplications: [],
      citations: [],
      sourceLink: "https://www.oncokb.org/",
      reviewLinks: [{ label: "OncoKB home", url: "https://www.oncokb.org/" }],
      caveat: "ONCOKB_API_TOKEN is missing. Add it to .env.local to enable live OncoKB annotation.",
    };
  }
  if (!variant.gene || !variant.proteinChange) {
    return {
      status: "not-found",
      therapeuticImplications: [],
      drugs: [],
      treatments: [],
      diagnosticImplications: [],
      prognosticImplications: [],
      citations: [],
      sourceLink: variant.gene ? oncokbReviewLink(variant.gene, variant.normalizedProteinChange) : "https://www.oncokb.org/",
      reviewLinks: variant.gene ? [{ label: "OncoKB gene/alteration page", url: oncokbReviewLink(variant.gene, variant.normalizedProteinChange) }] : [{ label: "OncoKB home", url: "https://www.oncokb.org/" }],
      caveat: "OncoKB protein-change annotation requires a gene symbol and protein alteration.",
    };
  }
  try {
    const url = new URL("https://www.oncokb.org/api/v1/annotate/mutations/byProteinChange");
    url.searchParams.set("hugoSymbol", variant.gene);
    url.searchParams.set("alteration", variant.normalizedProteinChange ?? variant.proteinChange.replace(/^p\./i, ""));
    url.searchParams.set("referenceGenome", mapReferenceGenome(variant.build));
    if (variant.cancerType) url.searchParams.set("tumorType", variant.cancerType);
    const data = await fetchJson<Record<string, unknown>>(url, { headers: { Authorization: `Bearer ${token}` } });
    const parsed = parseOncoKbResponse(data);
    return {
      status: "live",
      ...parsed,
      sourceLink: oncokbReviewLink(variant.gene, variant.normalizedProteinChange),
      reviewLinks: [
        { label: "OncoKB gene/alteration page", url: oncokbReviewLink(variant.gene, variant.normalizedProteinChange) },
        { label: "OncoKB search", url: `https://www.oncokb.org/search?query=${encodeURIComponent(`${variant.gene} ${variant.normalizedProteinChange ?? ""}`)}` },
      ],
      caveat: variant.cancerType
        ? "OncoKB actionability is tumor-type dependent and token/access dependent. Verify returned evidence in the linked source."
        : "OncoKB actionability is tumor-type dependent and token/access dependent. No tumor type was supplied, so evidence may be incomplete or nonspecific.",
      raw: data,
    };
  } catch (error) {
    return {
      status: "unavailable",
      therapeuticImplications: [],
      drugs: [],
      treatments: [],
      diagnosticImplications: [],
      prognosticImplications: [],
      citations: [],
      sourceLink: "https://www.oncokb.org/",
      reviewLinks: variant.gene ? [{ label: "OncoKB gene/alteration page", url: oncokbReviewLink(variant.gene, variant.normalizedProteinChange) }] : [{ label: "OncoKB home", url: "https://www.oncokb.org/" }],
      caveat: `OncoKB could not be queried at this time: ${errorMessage(error)}`,
    };
  }
}

export async function queryCbioPortal(variant: NormalizedVariant): Promise<CbioPortalResult> {
  const queriedStudies: CbioPortalResult["queriedStudies"] = [];
  try {
    const studiesUrl = new URL("/api/studies", CBIO_BASE);
    studiesUrl.searchParams.set("projection", "SUMMARY");
    const studies = await fetchJson<Array<Record<string, unknown>>>(studiesUrl);
    const selectedStudies = selectRelevantStudies(studies, variant).slice(0, variant.cancerType ? 8 : studies.length);
    const entrezGeneId = variant.gene ? ENTREZ_GENE_IDS[variant.gene.toUpperCase()] : undefined;
    if (!entrezGeneId) {
      return unavailableCbio("cBioPortal gene lookup is not configured for this gene in the MVP.", queriedStudies);
    }

    const studyResults = [];
    for (const study of selectedStudies) {
      const studyId = readString(study, ["studyId"]);
      if (!studyId) continue;
      try {
        const molecularProfiles = await fetchJson<Array<Record<string, unknown>>>(new URL(`/api/studies/${studyId}/molecular-profiles?projection=SUMMARY`, CBIO_BASE));
        const mutationProfile = molecularProfiles.find((profile) => readString(profile, ["molecularAlterationType"]) === "MUTATION_EXTENDED");
        const molecularProfileId = readString(mutationProfile, ["molecularProfileId"]);
        const sampleLists = await fetchJson<Array<Record<string, unknown>>>(new URL(`/api/studies/${studyId}/sample-lists?projection=SUMMARY`, CBIO_BASE));
        const sampleList = selectSampleList(sampleLists);
        const sampleListId = readString(sampleList, ["sampleListId"]);
        if (!molecularProfileId || !sampleListId) {
          queriedStudies.push({ studyId, name: readString(study, ["name"]), status: "skipped", message: "No mutation profile or sequenced sample list was available." });
          continue;
        }
        const mutationsUrl = new URL(`/api/molecular-profiles/${molecularProfileId}/mutations/fetch`, CBIO_BASE);
        mutationsUrl.searchParams.set("projection", "DETAILED");
        const mutations = await fetchJson<Array<Record<string, unknown>>>(mutationsUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entrezGeneIds: [entrezGeneId], sampleListId }),
        });
        const matches = mutations.map((mutation) => {
          const observedProtein = readString(mutation, ["proteinChange", "aminoAcidChange"]) ?? "";
          const proteinMatch = variant.proteinChangeCandidates.length ? isProteinMatch(observedProtein, variant.proteinChangeCandidates) : { matched: true, approximate: false };
          const coordinateMatch = coordinateMatches(mutation, variant);
          return { mutation, proteinChange: observedProtein, proteinMatch, coordinateMatch };
        }).filter((item) => item.proteinMatch.matched || item.coordinateMatch);
        queriedStudies.push({ studyId, name: readString(study, ["name"]), molecularProfileId, sampleListId, status: "queried", message: `${mutations.length} ${variant.gene} mutations fetched; ${matches.length} candidate match(es).` });
        if (matches.length) {
          const approximateMatches = matches.some((match) => match.proteinMatch.approximate && !match.coordinateMatch);
          studyResults.push({
            studyId,
            name: readString(study, ["name"]) ?? studyId,
            cancerType: readString(study, ["cancerTypeId"]),
            sampleCount: readSampleCount(sampleList),
            mutationCount: matches.length,
            matchingProteinChanges: Array.from(new Set(matches.map((match) => match.proteinChange).filter(Boolean))),
            approximateMatches,
            link: `${CBIO_BASE}/study/summary?id=${encodeURIComponent(studyId)}`,
            mutationFrequency: "Frequency denominator depends on the selected cBioPortal sample list.",
            rawMatches: matches.map((match) => match.mutation),
          });
        }
      } catch (error) {
        queriedStudies.push({ studyId, name: readString(study, ["name"]), status: "error", message: errorMessage(error) });
      }
    }

    const matchingStudies = studyResults.map((study) => {
      const { rawMatches, ...publicStudy } = study;
      void rawMatches;
      return publicStudy;
    });
    const mutationCount = matchingStudies.reduce((sum, study) => sum + (study.mutationCount ?? 0), 0);
    const matchingProteinChanges = Array.from(new Set(matchingStudies.flatMap((study) => study.matchingProteinChanges ?? [])));
    return {
      status: matchingStudies.length ? "live" : "not-found",
      matchingStudies,
      tumorTypes: Array.from(new Set(matchingStudies.map((study) => study.cancerType).filter(Boolean))) as string[],
      sampleCount: matchingStudies.reduce((sum, study) => sum + (study.sampleCount ?? 0), 0) || undefined,
      mutationCount: mutationCount || undefined,
      matchingProteinChanges,
      queriedStudies,
      sourceLink: `${CBIO_BASE}/results/mutations?case_set_id=all&Action=Submit${variant.gene ? `&gene_list=${encodeURIComponent(variant.gene)}` : ""}`,
      reviewLinks: [
        { label: "cBioPortal mutation results", url: `${CBIO_BASE}/results/mutations?case_set_id=all&Action=Submit${variant.gene ? `&gene_list=${encodeURIComponent(variant.gene)}` : ""}` },
        ...matchingStudies.slice(0, 8).map((study) => ({ label: `${study.studyId} study page`, url: study.link ?? `${CBIO_BASE}/study/summary?id=${encodeURIComponent(study.studyId)}` })),
      ],
      caveat: matchingStudies.length
        ? "cBioPortal match status is based on queried public studies and local protein/coordinate filtering; approximate protein matches are labeled in study rows."
        : "No exact match was found in the queried cBioPortal studies.",
      raw: { selectedStudies, studyResults },
    };
  } catch (error) {
    return unavailableCbio(`cBioPortal could not be queried at this time: ${errorMessage(error)}`, queriedStudies);
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

function readSampleCount(sampleList: unknown) {
  return readNumber(sampleList, ["sampleCount", "allSampleCount", "sequencedSampleCount"])
    ?? parseCountFromText(readString(sampleList, ["description", "name"]));
}

function parseCountFromText(value?: string) {
  const match = value?.match(/\(([\d,]+)\s+samples?\)/i) ?? value?.match(/([\d,]+)\s+samples?/i);
  return match ? Number(match[1].replace(/,/g, "")) || undefined : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function selectRelevantStudies(studies: Array<Record<string, unknown>>, variant: NormalizedVariant) {
  const tumor = variant.cancerType?.toLowerCase();
  const gene = variant.gene?.toLowerCase();
  const scored = studies.map((study) => {
    const studyId = readString(study, ["studyId"]) ?? "";
    const haystack = [
      studyId,
      readString(study, ["name"]),
      readString(study, ["description"]),
      readString(study, ["cancerTypeId"]),
    ].join(" ").toLowerCase();
    let score = 0;
    if (tumor && (haystack.includes(tumor) || tumor === "aml" && haystack.includes("acute myeloid"))) score += 100;
    if (/tcga|msk|aml|laml|beataml|ohsu|target/.test(studyId.toLowerCase())) score += 10;
    if (gene && haystack.includes(gene)) score += 2;
    return { study, score };
  });
  const minimum = tumor ? 100 : 0;
  return scored.filter((item) => item.score >= minimum).sort((a, b) => b.score - a.score).map((item) => item.study);
}

function selectSampleList(sampleLists: Array<Record<string, unknown>>) {
  return sampleLists.find((list) => /sequenced|seq|mutation/i.test(readString(list, ["sampleListId", "category", "name"]) ?? ""))
    ?? sampleLists.find((list) => /all/i.test(readString(list, ["sampleListId", "category", "name"]) ?? ""))
    ?? sampleLists[0];
}

function coordinateMatches(mutation: Record<string, unknown>, variant: NormalizedVariant) {
  const start = readNumber(mutation, ["startPosition"]);
  const chromosome = readString(mutation, ["chr", "chromosome"]);
  const build = readString(mutation, ["ncbiBuild"]);
  const coordinate = build?.includes("38") ? variant.hg38 : variant.hg19;
  return Boolean(start && coordinate && start === coordinate.pos && (!chromosome || chromosome.replace(/^chr/i, "") === coordinate.chrom.replace(/^chr/i, "")));
}

function unavailableCbio(message: string, queriedStudies: CbioPortalResult["queriedStudies"]): CbioPortalResult {
  return {
    status: "unavailable",
    matchingStudies: [],
    tumorTypes: [],
    matchingProteinChanges: [],
    queriedStudies,
    sourceLink: `${CBIO_BASE}/`,
    reviewLinks: [{ label: "cBioPortal studies", url: `${CBIO_BASE}/datasets` }],
    caveat: message,
  };
}

function clinvarVariantSearchLink(variant: NormalizedVariant) {
  const terms = [variant.gene, variant.genomicHgvs, variant.proteinChange].filter(Boolean).join(" ");
  return `https://www.ncbi.nlm.nih.gov/clinvar/?term=${encodeURIComponent(terms)}`;
}

function oncokbReviewLink(gene: string, alteration?: string) {
  const suffix = alteration ? `/${encodeURIComponent(alteration)}` : "";
  return `https://www.oncokb.org/gene/${encodeURIComponent(gene)}${suffix}`;
}

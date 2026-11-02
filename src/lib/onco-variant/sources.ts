import type { CbioPortalResult, CivicResult, ClinVarClassification, ClinVarResult, ComputationalPredictionResult, CosmicResult, GenieResult, GnomadResult, NormalizedVariant, OncoKbResult, PracticalImportPackage } from "./types";
import { isProteinMatch, mapReferenceGenome, parseOncoKbResponse } from "./parsers.mjs";
import { HttpError, fetchJson } from "./http.ts";

const CBIO_BASE = "https://www.cbioportal.org";
const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const GNOMAD_API = "https://gnomad.broadinstitute.org/api";
const MYVARIANT_BASE = "https://myvariant.info/v1";
const CIVIC_BASE = "https://civicdb.org";
const CIVIC_API = "https://civicdb.org/api/graphql";
const COSMIC_BASE = "https://cancer.sanger.ac.uk/cosmic";
const COSMIC_CLINICAL_TABLES = "https://clinicaltables.nlm.nih.gov/api/cosmic/v4/search";
const MAX_STUDIES_QUERIED = 8;
const CBIO_STUDY_CONCURRENCY = 4;
const CBIO_STUDIES_TTL_MS = 5 * 60 * 1000;
const CBIO_QUERY_CACHE_TTL_MS = 10 * 60 * 1000;
const PREFERRED_REFSEQ_TRANSCRIPTS: Record<string, string> = {
  TP53: "NM_000546.6",
};
const entrezGeneIdCache = new Map<string, number | null>();
const entrezGeneIdInFlight = new Map<string, Promise<number | null>>();
const refSeqTranscriptCache = new Map<string, string | null>();
let cbioStudiesCache: { expiresAt: number; value: Array<Record<string, unknown>> } | undefined;
let cbioStudiesInFlight: Promise<Array<Record<string, unknown>>> | undefined;
const cbioStudyConfigCache = new Map<string, { expiresAt: number; promise: Promise<{
  molecularProfileId?: string;
  sampleListId?: string;
  sampleList?: Record<string, unknown>;
}> }>();
const cbioMutationCache = new Map<string, { expiresAt: number; promise: Promise<Array<Record<string, unknown>>> }>();
type GnomadPopulation = NonNullable<GnomadResult["populations"]>[number];

async function getCbioStudies() {
  if (cbioStudiesCache && cbioStudiesCache.expiresAt > Date.now()) return cbioStudiesCache.value;
  if (cbioStudiesInFlight) return cbioStudiesInFlight;
  const studiesUrl = new URL("/api/studies", CBIO_BASE);
  studiesUrl.searchParams.set("projection", "SUMMARY");
  cbioStudiesInFlight = fetchJson<Array<Record<string, unknown>>>(studiesUrl)
    .then((value) => {
      cbioStudiesCache = { expiresAt: Date.now() + CBIO_STUDIES_TTL_MS, value };
      return value;
    })
    .finally(() => {
      cbioStudiesInFlight = undefined;
    });
  return cbioStudiesInFlight;
}

function getCbioStudyConfig(studyId: string) {
  return cachedPromise(cbioStudyConfigCache, studyId, CBIO_QUERY_CACHE_TTL_MS, async () => {
    const [molecularProfiles, sampleLists] = await Promise.all([
      fetchJson<Array<Record<string, unknown>>>(new URL(`/api/studies/${studyId}/molecular-profiles?projection=SUMMARY`, CBIO_BASE)),
      fetchJson<Array<Record<string, unknown>>>(new URL(`/api/studies/${studyId}/sample-lists?projection=SUMMARY`, CBIO_BASE)),
    ]);
    const mutationProfile = molecularProfiles.find((profile) => readString(profile, ["molecularAlterationType"]) === "MUTATION_EXTENDED");
    const sampleList = selectSampleList(sampleLists);
    return {
      molecularProfileId: readString(mutationProfile, ["molecularProfileId"]),
      sampleListId: readString(sampleList, ["sampleListId"]),
      sampleList,
    };
  });
}

function getCbioGeneMutations(molecularProfileId: string, sampleListId: string, entrezGeneId: number) {
  const key = `${molecularProfileId}:${sampleListId}:${entrezGeneId}`;
  return cachedPromise(cbioMutationCache, key, CBIO_QUERY_CACHE_TTL_MS, async () => {
    const mutationsUrl = new URL(`/api/molecular-profiles/${molecularProfileId}/mutations/fetch`, CBIO_BASE);
    mutationsUrl.searchParams.set("projection", "DETAILED");
    return fetchJson<Array<Record<string, unknown>>>(mutationsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entrezGeneIds: [entrezGeneId], sampleListId }),
    });
  });
}

function cachedPromise<T>(
  cache: Map<string, { expiresAt: number; promise: Promise<T> }>,
  key: string,
  ttlMs: number,
  operation: () => Promise<T>,
) {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = operation().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { expiresAt: Date.now() + ttlMs, promise });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return promise;
}

async function resolveEntrezGeneId(gene: string): Promise<number | null> {
  const key = gene.toUpperCase();
  if (entrezGeneIdCache.has(key)) return entrezGeneIdCache.get(key) ?? null;
  const existing = entrezGeneIdInFlight.get(key);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const data = await fetchJson<Record<string, unknown>>(new URL(`/api/genes/${encodeURIComponent(key)}`, CBIO_BASE));
      const id = readNumber(data, ["entrezGeneId"]) ?? null;
      entrezGeneIdCache.set(key, id);
      return id;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        entrezGeneIdCache.set(key, null);
        return null;
      }
      throw error;
    } finally {
      entrezGeneIdInFlight.delete(key);
    }
  })();
  entrezGeneIdInFlight.set(key, promise);
  return promise;
}

export async function resolveRefSeqTranscript(gene: string): Promise<string | undefined> {
  const key = gene.toUpperCase();
  if (refSeqTranscriptCache.has(key)) return refSeqTranscriptCache.get(key) ?? undefined;
  const preferred = PREFERRED_REFSEQ_TRANSCRIPTS[key];
  if (preferred) {
    refSeqTranscriptCache.set(key, preferred);
    return preferred;
  }
  try {
    const entrezGeneId = await resolveEntrezGeneId(key);
    if (!entrezGeneId) {
      refSeqTranscriptCache.set(key, null);
      return undefined;
    }
    const linkUrl = new URL(`${EUTILS_BASE}/elink.fcgi`);
    linkUrl.searchParams.set("dbfrom", "gene");
    linkUrl.searchParams.set("db", "nuccore");
    linkUrl.searchParams.set("id", String(entrezGeneId));
    linkUrl.searchParams.set("linkname", "gene_nuccore_refseqrna");
    linkUrl.searchParams.set("retmode", "json");
    if (process.env.NCBI_API_KEY) linkUrl.searchParams.set("api_key", process.env.NCBI_API_KEY);
    const linkData = await fetchJson<{ linksets?: Array<{ linksetdbs?: Array<{ links?: string[] }> }> }>(linkUrl);
    const uids = (linkData.linksets?.[0]?.linksetdbs?.[0]?.links ?? []).slice(0, 20);
    if (!uids.length) {
      refSeqTranscriptCache.set(key, null);
      return undefined;
    }

    const summaryUrl = new URL(`${EUTILS_BASE}/esummary.fcgi`);
    summaryUrl.searchParams.set("db", "nuccore");
    summaryUrl.searchParams.set("id", uids.join(","));
    summaryUrl.searchParams.set("retmode", "json");
    if (process.env.NCBI_API_KEY) summaryUrl.searchParams.set("api_key", process.env.NCBI_API_KEY);
    const summary = await fetchJson<Record<string, unknown>>(summaryUrl);
    const result = summary.result as Record<string, unknown> | undefined;
    const accessions = uids
      .map((uid) => readString(result?.[uid], ["accessionversion"]))
      .filter((accession): accession is string => Boolean(accession?.startsWith("NM_")));
    const transcript = accessions.find((accession) => accession === preferred) ?? accessions[0];
    refSeqTranscriptCache.set(key, transcript ?? null);
    return transcript;
  } catch {
    return undefined;
  }
}

function clinvarCoordinateTerm(variant: NormalizedVariant): string {
  const positionField = variant.build === "hg19" ? "C37" : "CPOS";
  return [variant.gene ? `${variant.gene}[gene]` : undefined, `${variant.chrom.replace(/^chr/i, "")}[chr]`, `${variant.pos}[${positionField}]`].filter(Boolean).join(" AND ");
}

async function esearchClinVar(term: string): Promise<string[]> {
  const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  searchUrl.searchParams.set("db", "clinvar");
  searchUrl.searchParams.set("retmode", "json");
  searchUrl.searchParams.set("retmax", "10");
  searchUrl.searchParams.set("term", term);
  if (process.env.NCBI_API_KEY) searchUrl.searchParams.set("api_key", process.env.NCBI_API_KEY);
  const search = await fetchJson<{ esearchresult?: { idlist?: string[] } }>(searchUrl);
  return search.esearchresult?.idlist ?? [];
}

function selectBestClinVarCandidate(candidates: Array<{ uid: string; record: Record<string, unknown> }>, variant: NormalizedVariant) {
  if (candidates.length <= 1 || !variant.proteinChangeCandidates.length) {
    return { ...candidates[0], matched: candidates.length <= 1 };
  }
  const scored = candidates.map((candidate) => {
    const proteinChanges = (readString(candidate.record, ["protein_change"]) ?? "").split(/,\s*/).filter(Boolean);
    const matched = proteinChanges.some((change) => isProteinMatch(change, variant.proteinChangeCandidates).matched);
    return { ...candidate, matched };
  });
  return scored.find((candidate) => candidate.matched) ?? { ...scored[0], matched: false };
}

export async function queryClinVar(variant: NormalizedVariant): Promise<ClinVarResult> {
  const clinvarSearchLink = clinvarVariantSearchLink(variant);
  try {
    let ids = await esearchClinVar(clinvarCoordinateTerm(variant));
    if (!ids.length && variant.gene && variant.refSeqTranscript) {
      ids = await esearchClinVar(`${variant.refSeqTranscript} AND ${variant.gene}[gene]`);
    }
    if (!ids.length) {
      return {
        status: "not_found",
        gene: variant.gene,
        molecularConsequence: [],
        hgvsNames: [variant.genomicHgvs],
        populationFrequencies: [],
        crossReferences: [],
        sourceLink: clinvarSearchLink,
        reviewLinks: [{ label: "ClinVar search for submitted variant", url: clinvarSearchLink }],
        caveat: "No exact ClinVar record was found for the submitted search terms.",
      };
    }

    const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
    summaryUrl.searchParams.set("db", "clinvar");
    summaryUrl.searchParams.set("retmode", "json");
    summaryUrl.searchParams.set("id", ids.join(","));
    if (process.env.NCBI_API_KEY) summaryUrl.searchParams.set("api_key", process.env.NCBI_API_KEY);
    const summary = await fetchJson<Record<string, unknown>>(summaryUrl);
    const resultBlock = summary.result as Record<string, unknown> | undefined;
    const candidates = ids
      .map((uid) => ({ uid, record: resultBlock?.[uid] as Record<string, unknown> | undefined }))
      .filter((candidate): candidate is { uid: string; record: Record<string, unknown> } => Boolean(candidate.record));
    if (!candidates.length) {
      return {
        status: "not_found",
        gene: variant.gene,
        molecularConsequence: [],
        hgvsNames: [variant.genomicHgvs],
        populationFrequencies: [],
        crossReferences: [],
        sourceLink: clinvarSearchLink,
        reviewLinks: [{ label: "ClinVar search for submitted variant", url: clinvarSearchLink }],
        caveat: "No exact ClinVar record was found for the submitted search terms.",
      };
    }

    const { uid: id, record, matched } = selectBestClinVarCandidate(candidates, variant);
    const variationEntry = (record?.variation_set as Array<Record<string, unknown>> | undefined)?.[0];
    const scvSubmissions = (record?.supporting_submissions as Record<string, unknown> | undefined)?.scv;
    const ambiguityCaveat = candidates.length > 1 && !matched
      ? ` Note: ${candidates.length} ClinVar records share this genomic position; the selected record's protein change could not be confirmed to match the submitted protein change (${variant.proteinChange ?? "not provided"}) — verify against the linked ClinVar variation page before clinical use.`
      : "";

    return {
      status: "available",
      germlineClassification: readClassification(record?.germline_classification),
      somaticClinicalImpact: readClassification(record?.clinical_impact_classification),
      oncogenicityClassification: readClassification(record?.oncogenicity_classification),
      variantType: readString(variationEntry, ["variant_type"]) ?? readString(record, ["obj_type"]),
      cdnaChange: readString(variationEntry, ["cdna_change"]),
      molecularConsequence: Array.isArray(record?.molecular_consequence_list) ? (record.molecular_consequence_list as unknown[]).map(String) : [],
      proteinChangeAcrossTranscripts: readString(record, ["protein_change"]),
      submissionCount: Array.isArray(scvSubmissions) ? scvSubmissions.length : undefined,
      variationId: readString(record, ["variation_id", "variationid", "uid"]) ?? id,
      vcvAccession: readString(record, ["accession", "vcv", "variation_set_name"]),
      gene: variant.gene ?? readString(record, ["gene_sort", "genesymbol"]),
      hgvsNames: [variant.genomicHgvs],
      populationFrequencies: readAlleleFrequencies(variationEntry),
      crossReferences: readCrossReferences(variationEntry),
      sourceLink: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${id}/`,
      reviewLinks: [
        { label: "ClinVar variation page", url: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${id}/` },
        { label: "ClinVar search for submitted variant", url: clinvarSearchLink },
      ],
      caveat: `ClinVar reports germline, somatic clinical impact, and oncogenicity as independent classification tracks; a track with no data means no submission exists for it, not that it was not checked.${ambiguityCaveat}`,
      raw: record,
    };
  } catch (error) {
    return {
      status: "query_failed",
      gene: variant.gene,
      molecularConsequence: [],
      hgvsNames: [variant.genomicHgvs],
      populationFrequencies: [],
      crossReferences: [],
      sourceLink: clinvarSearchLink,
      reviewLinks: [{ label: "ClinVar search for submitted variant", url: clinvarSearchLink }],
      caveat: `ClinVar could not be queried at this time: ${errorMessage(error)}`,
    };
  }
}

function readAlleleFrequencies(variationEntry: Record<string, unknown> | undefined) {
  const alleleFreqSet = variationEntry?.allele_freq_set;
  if (!Array.isArray(alleleFreqSet)) return [];
  return alleleFreqSet
    .map((entry) => ({ source: readString(entry, ["source"]), value: readString(entry, ["value"]) }))
    .filter((entry): entry is { source: string; value: string } => Boolean(entry.source && entry.value));
}

function readCrossReferences(variationEntry: Record<string, unknown> | undefined) {
  const xrefs = variationEntry?.variation_xrefs;
  if (!Array.isArray(xrefs)) return [];
  return xrefs
    .map((entry) => ({ db: readString(entry, ["db_source"]), id: readString(entry, ["db_id"]) }))
    .filter((entry): entry is { db: string; id: string } => Boolean(entry.db && entry.id));
}

function readClassification(block: unknown): ClinVarClassification | undefined {
  const description = readString(block, ["description"]);
  if (!description) return undefined;
  const traitSet = (block as Record<string, unknown>).trait_set;
  const conditions = Array.isArray(traitSet)
    ? traitSet.map((trait) => readString(trait, ["trait_name"])).filter((name): name is string => Boolean(name))
    : [];
  return {
    description,
    reviewStatus: readString(block, ["review_status"]),
    lastEvaluated: readString(block, ["last_evaluated"]),
    conditions,
  };
}

export async function queryOncoKb(variant: NormalizedVariant): Promise<OncoKbResult> {
  const token = process.env.ONCOKB_API_TOKEN;
  if (!token) {
    return {
      status: "permission_denied",
      therapeuticImplications: [],
      otherSignificantResistanceLevels: [],
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
      status: "not_found",
      therapeuticImplications: [],
      otherSignificantResistanceLevels: [],
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
      status: "available",
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
      status: "query_failed",
      therapeuticImplications: [],
      otherSignificantResistanceLevels: [],
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
    const studies = await getCbioStudies();
    const selectedStudies = selectRelevantStudies(studies, variant).slice(0, MAX_STUDIES_QUERIED);
    return await queryCbioPortalSelectedStudies(variant, selectedStudies, queriedStudies, {
      unavailableMessage: "cBioPortal lookup requires a gene symbol.",
      noMatchMessage: "No exact match was found in the queried cBioPortal studies.",
      sourceLabel: "cBioPortal",
    });
  } catch (error) {
    return unavailableCbio(`cBioPortal could not be queried at this time: ${errorMessage(error)}`, queriedStudies);
  }
}

export async function queryAacrGenie(variant: NormalizedVariant): Promise<GenieResult> {
  const queriedStudies: CbioPortalResult["queriedStudies"] = [];
  try {
    const studies = await getCbioStudies();
    const selectedStudies = studies
      .filter((study) => {
        const haystack = [readString(study, ["studyId"]), readString(study, ["name"]), readString(study, ["description"])].join(" ").toLowerCase();
        return haystack.includes("genie");
      })
      .slice(0, MAX_STUDIES_QUERIED);
    const result = await queryCbioPortalSelectedStudies(variant, selectedStudies, queriedStudies, {
      unavailableMessage: "AACR GENIE lookup requires a gene symbol.",
      noMatchMessage: "No exact match was found in queried AACR GENIE public cBioPortal studies.",
      sourceLabel: "AACR GENIE",
    });
    return { ...result, registry: "AACR_GENIE" };
  } catch (error) {
    return { ...unavailableCbio(`AACR GENIE public cBioPortal studies could not be queried at this time: ${errorMessage(error)}`, queriedStudies), registry: "AACR_GENIE" };
  }
}

async function queryCbioPortalSelectedStudies(
  variant: NormalizedVariant,
  selectedStudies: Array<Record<string, unknown>>,
  queriedStudies: CbioPortalResult["queriedStudies"],
  opts: { unavailableMessage: string; noMatchMessage: string; sourceLabel: string },
): Promise<CbioPortalResult> {
    if (!variant.gene) {
      return unavailableCbio(opts.unavailableMessage, queriedStudies);
    }
    const entrezGeneId = await resolveEntrezGeneId(variant.gene);
    if (!entrezGeneId) {
      return notFoundCbio(`Gene "${variant.gene}" was not found in cBioPortal's gene list.`, queriedStudies);
    }

    const studyResults: Array<{
      studyId: string;
      name: string;
      cancerType?: string;
      sampleCount?: number;
      mutationCount: number;
      matchingProteinChanges: string[];
      approximateMatches: boolean;
      link: string;
      mutationFrequency: string;
      sampleLevelEvidence: Array<{ sampleId: string; mutationStatus?: string; vaf?: number }>;
      rawMatches: Array<Record<string, unknown>>;
    }> = [];
    await mapWithConcurrency(selectedStudies, CBIO_STUDY_CONCURRENCY, async (study) => {
      const studyId = readString(study, ["studyId"]);
      if (!studyId) return;
      try {
        const { molecularProfileId, sampleListId, sampleList } = await getCbioStudyConfig(studyId);
        if (!molecularProfileId || !sampleListId) {
          queriedStudies.push({ studyId, name: readString(study, ["name"]), status: "skipped", message: "No mutation profile or sequenced sample list was available." });
          return;
        }
        const mutations = await getCbioGeneMutations(molecularProfileId, sampleListId, entrezGeneId);
        const matches = mutations.map((mutation) => {
          const observedProtein = readString(mutation, ["proteinChange", "aminoAcidChange"]) ?? "";
          const proteinMatch = variant.proteinChangeCandidates.length ? isProteinMatch(observedProtein, variant.proteinChangeCandidates) : { matched: true, approximate: false };
          const coordinateMatch = coordinateMatches(mutation, variant);
          return { mutation, proteinChange: observedProtein, proteinMatch, coordinateMatch };
        }).filter((item) => item.proteinMatch.matched || item.coordinateMatch);
        queriedStudies.push({ studyId, name: readString(study, ["name"]), molecularProfileId, sampleListId, status: "queried", message: `${mutations.length} ${variant.gene} mutations fetched; ${matches.length} candidate match(es).` });
        if (matches.length) {
          const approximateMatches = matches.some((match) => match.proteinMatch.approximate && !match.coordinateMatch);
          const sampleCount = readSampleCount(sampleList);
          studyResults.push({
            studyId,
            name: readString(study, ["name"]) ?? studyId,
            cancerType: readString(study, ["cancerTypeId"]),
            sampleCount,
            mutationCount: matches.length,
            matchingProteinChanges: Array.from(new Set(matches.map((match) => match.proteinChange).filter(Boolean))),
            approximateMatches,
            link: `${CBIO_BASE}/study/summary?id=${encodeURIComponent(studyId)}`,
            mutationFrequency: sampleCount ? `${matches.length}/${sampleCount} (${((matches.length / sampleCount) * 100).toFixed(1)}%)` : "Sample count unavailable for this study's sample list.",
            sampleLevelEvidence: matches.map((match) => readSampleLevelEvidence(match.mutation)),
            rawMatches: matches.map((match) => match.mutation),
          });
        }
      } catch (error) {
        queriedStudies.push({ studyId, name: readString(study, ["name"]), status: "error", message: errorMessage(error) });
      }
    });

    queriedStudies.sort((a, b) => a.studyId.localeCompare(b.studyId));
    studyResults.sort((a, b) => a.studyId.localeCompare(b.studyId));

    const matchingStudies = studyResults.map((study) => {
      const { rawMatches, ...publicStudy } = study;
      void rawMatches;
      return publicStudy;
    });
    const mutationCount = matchingStudies.reduce((sum, study) => sum + (study.mutationCount ?? 0), 0);
    const matchingProteinChanges = Array.from(new Set(matchingStudies.flatMap((study) => study.matchingProteinChanges ?? [])));
    return {
      status: matchingStudies.length ? "available" : "not_found",
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
        : opts.noMatchMessage,
      raw: { selectedStudies, studyResults },
    };
}

export async function queryCivic(variant: NormalizedVariant): Promise<CivicResult> {
  const searchTerm = [variant.gene, variant.normalizedProteinChange ?? variant.proteinChange].filter(Boolean).join(" ");
  const sourceLink = `${CIVIC_BASE}/search?query=${encodeURIComponent(searchTerm || variant.genomicHgvs)}`;
  if (!variant.gene) {
    return {
      status: "not_applicable",
      molecularProfiles: [],
      evidenceItems: [],
      sourceLink,
      reviewLinks: [{ label: "CIViC search", url: sourceLink }],
      caveat: "CIViC lookup requires a gene symbol.",
    };
  }
  try {
    const query = `query MolecularProfiles($name: String!) {
      molecularProfiles(name: $name, first: 10) {
        nodes {
          id
          name
          link
          evidenceItems { totalCount }
          assertions { totalCount }
        }
      }
    }`;
    const data = await fetchJson<{ data?: { molecularProfiles?: { nodes?: Array<Record<string, unknown>> } }; errors?: unknown }>(new URL(CIVIC_API), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { name: searchTerm } }),
    });
    if (data.errors) throw new Error("CIViC GraphQL response contained errors");
    const nodes = data.data?.molecularProfiles?.nodes ?? [];
    const molecularProfiles = nodes.map((node) => ({
      id: readString(node, ["id"]),
      name: readString(node, ["name"]) ?? "Unnamed molecular profile",
      link: readString(node, ["link"]),
      evidenceItemCount: readNumber(node.evidenceItems, ["totalCount"]),
      assertionCount: readNumber(node.assertions, ["totalCount"]),
    }));
    return {
      status: molecularProfiles.length ? "available" : "not_found",
      molecularProfiles,
      evidenceItems: [],
      sourceLink,
      reviewLinks: [{ label: "CIViC search", url: sourceLink }, ...molecularProfiles.slice(0, 5).map((profile) => ({ label: `CIViC ${profile.name}`, url: profile.link ?? sourceLink }))],
      caveat: molecularProfiles.length
        ? "CIViC molecular profiles were imported as external evidence candidates. Evidence items/assertions are not converted into criteria without deterministic validation."
        : "No CIViC molecular profile was found for the submitted gene/protein search term.",
      raw: data,
    };
  } catch (error) {
    return {
      status: "query_failed",
      molecularProfiles: [],
      evidenceItems: [],
      sourceLink,
      reviewLinks: [{ label: "CIViC search", url: sourceLink }],
      caveat: `CIViC could not be queried at this time: ${errorMessage(error)}`,
    };
  }
}

export async function queryCosmic(variant: NormalizedVariant): Promise<CosmicResult> {
  const query = [variant.gene, variant.normalizedProteinChange ?? variant.proteinChange].filter(Boolean).join(" ");
  const sourceLink = `${COSMIC_BASE}/search?q=${encodeURIComponent(query || variant.genomicHgvs)}`;
  try {
    const url = new URL(COSMIC_CLINICAL_TABLES);
    url.searchParams.set("terms", query || variant.genomicHgvs);
    url.searchParams.set("maxList", "10");
    const data = await fetchJson<unknown[]>(url);
    const rows = Array.isArray(data[3]) ? data[3] as unknown[] : [];
    const matches = rows.map((row) => {
      const values = Array.isArray(row) ? row.map((value) => value == null ? undefined : String(value)) : [];
      return {
        gene: values.find((value) => value?.toUpperCase() === variant.gene?.toUpperCase()) ?? variant.gene,
        mutation: values.find((value) => value && /[A-Z][0-9]+[A-Z*]|p\./i.test(value)) ?? variant.proteinChange,
        disease: values.find((value) => value && /carcinoma|leukemia|lymphoma|tumou?r|cancer|neoplasm/i.test(value)),
        source: "NLM Clinical Tables COSMIC v4",
      };
    });
    return {
      status: matches.length ? "available" : "not_found",
      matches,
      sourceLink,
      reviewLinks: [
        { label: "COSMIC search", url: sourceLink },
        { label: "NLM COSMIC API query", url: url.toString() },
      ],
      caveat: matches.length
        ? "COSMIC-derived NLM Clinical Tables matches were imported as external recurrence candidates. This reduced public API does not replace licensed COSMIC review and is not converted directly into formal criteria."
        : "No COSMIC-derived NLM Clinical Tables match was found for the submitted query term.",
      raw: data,
    };
  } catch (error) {
    return {
      status: "query_failed",
      matches: [],
      sourceLink,
      reviewLinks: [{ label: "COSMIC search", url: sourceLink }],
      caveat: `COSMIC-derived NLM Clinical Tables data could not be queried at this time: ${errorMessage(error)}. Licensed COSMIC review may still be required.`,
    };
  }
}

export function buildPracticalImportPackage(input: {
  normalizedVariant: NormalizedVariant;
  clinvar: ClinVarResult;
  oncokb: OncoKbResult;
  cbioportal: CbioPortalResult;
  aacrGenie: GenieResult;
  gnomad: GnomadResult;
  computationalPrediction: ComputationalPredictionResult;
  civic: CivicResult;
  cosmic: CosmicResult;
}): PracticalImportPackage {
  const reached = (status: string) => status === "available" || status === "not_found" || status === "not_returned";
  const imported = (status: string) => status === "available" ? "imported" : reached(status) ? "partial" : "unavailable";
  const v = input.normalizedVariant;
  const caveats: string[] = [];
  if (!v.codingHgvs || !v.proteinHgvs) caveats.push("VEP transcript/protein annotation was not fully imported; consequence-specific criteria may remain not assessed.");
  if (!v.specimenMaterial || v.specimenMaterial === "unknown") caveats.push("Specimen context is missing or unknown; origin assessment remains limited.");
  caveats.push("Treatment context and diagnostic context are user-input requirements and are not yet captured by this request model.");
  return {
    vepAnnotation: v.codingHgvs || v.proteinHgvs ? "imported" : "partial",
    clinvarTracks: imported(input.clinvar.status),
    gnomadPopulation: imported(input.gnomad.status),
    oncokb: imported(input.oncokb.status),
    cbioportal: imported(input.cbioportal.status),
    aacrGenie: imported(input.aacrGenie.status),
    civic: imported(input.civic.status),
    cosmic: imported(input.cosmic.status),
    diseaseOntology: v.disease ? "imported" : "user_input_required",
    guidelineRegistry: "imported",
    specimenContext: v.specimenMaterial && v.specimenMaterial !== "unknown" ? "imported" : "user_input_required",
    treatmentContext: "user_input_required",
    diagnosticContext: "user_input_required",
    caveats,
  };
}

export async function queryGnomad(variant: NormalizedVariant): Promise<GnomadResult> {
  const gnomadSiteLink = "https://gnomad.broadinstitute.org/";
  const build38 = variant.hg38 ?? (variant.build === "hg38" ? variant : undefined);
  const build19 = variant.hg19 ?? (variant.build === "hg19" ? variant : undefined);
  const coordinate = build38 ?? build19;
  const usedFallbackBuild = !build38 && Boolean(build19);
  if (!coordinate) {
    return {
      status: "query_failed",
      rsIds: [],
      sourceLink: gnomadSiteLink,
      reviewLinks: [{ label: "gnomAD home", url: gnomadSiteLink }],
      caveat: "gnomAD could not be queried: no GRCh38 or GRCh37 coordinate was available for this variant (liftover did not resolve either build).",
    };
  }
  const datasetId = usedFallbackBuild ? "gnomad_r2_1" : "gnomad_r4";
  const release = usedFallbackBuild ? "2.1" : "4";
  const variantId = `${coordinate.chrom.replace(/^chr/i, "")}-${coordinate.pos}-${variant.ref}-${variant.alt}`;
  const gnomadVariantLink = `https://gnomad.broadinstitute.org/variant/${variantId}?dataset=${datasetId}`;
  const fallbackNote = usedFallbackBuild ? " Queried against the GRCh37 (r2.1) dataset because a GRCh38 coordinate was not available." : "";
  try {
    const query = `query VariantQuery($variantId: String!, $datasetId: DatasetId!) {
      variant(variantId: $variantId, dataset: $datasetId) {
        variant_id
        rsids
        genome { af ac an homozygote_count populations { id ac an } }
        exome { af ac an homozygote_count populations { id ac an } }
      }
    }`;
    const data = await fetchJson<{ data?: { variant?: Record<string, unknown> | null } }>(new URL(GNOMAD_API), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { variantId, datasetId } }),
    });
    const record = data.data?.variant;
    if (!record) {
      return {
        status: "not_found",
        rsIds: [],
        sourceLink: gnomadVariantLink,
        reviewLinks: [{ label: "gnomAD variant search", url: gnomadVariantLink }],
        caveat: `No exact gnomAD record was found for this variant in the queried dataset.${fallbackNote}`,
      };
    }
    const genome = record.genome as Record<string, unknown> | undefined;
    const exome = record.exome as Record<string, unknown> | undefined;
    const primary = genome ?? exome;
    const populations = (primary?.populations as Array<Record<string, unknown>> | undefined) ?? [];
    const normalizedPopulations: GnomadPopulation[] = populations
      .map((population): GnomadPopulation | undefined => {
        const ac = readNumber(population, ["ac"]);
        const an = readNumber(population, ["an"]);
        const id = readString(population, ["id"]);
        if (!id) return undefined;
        return {
          population: id,
          alleleCount: ac,
          alleleNumber: an,
          alleleFrequency: ac !== undefined && an ? ac / an : undefined,
        };
      })
      .filter((population): population is GnomadPopulation => Boolean(population));
    const popmax = normalizedPopulations
      .filter((population): population is GnomadPopulation & { alleleFrequency: number } => population.alleleFrequency !== undefined)
      .sort((a, b) => b.alleleFrequency - a.alleleFrequency)[0];
    return {
      status: "available",
      database: "gnomAD",
      release,
      dataset: datasetId,
      alleleFrequency: readNumber(primary, ["af"]),
      alleleCount: readNumber(primary, ["ac"]),
      alleleNumber: readNumber(primary, ["an"]),
      homozygoteCount: readNumber(primary, ["homozygote_count"]),
      popmaxFrequency: popmax?.alleleFrequency,
      popmaxPopulation: popmax?.population,
      filteringAlleleFrequency: readNumber(primary, ["faf95", "faf"]),
      coverage: primary ? "not_returned_by_query" : undefined,
      qualityStatus: "available",
      populations: normalizedPopulations,
      rsIds: Array.isArray(record.rsids) ? (record.rsids as unknown[]).map(String) : [],
      sourceLink: gnomadVariantLink,
      reviewLinks: [{ label: "gnomAD variant page", url: gnomadVariantLink }],
      caveat: `gnomAD frequency can support rarity/benign-population criteria only after successful query and adequacy review; this adapter preserves dataset, release, AC/AN/AF, and population maximum, but coverage is not returned by the current query.${fallbackNote}`,
      raw: record,
    };
  } catch (error) {
    return {
      status: "query_failed",
      rsIds: [],
      sourceLink: gnomadSiteLink,
      reviewLinks: [{ label: "gnomAD home", url: gnomadSiteLink }],
      caveat: `gnomAD could not be queried at this time: ${errorMessage(error)}`,
    };
  }
}

export async function queryComputationalPrediction(variant: NormalizedVariant): Promise<ComputationalPredictionResult> {
  const myVariantSiteLink = "https://myvariant.info/";
  try {
    const hgvs = variant.genomicHgvs;
    const url = new URL(`/v1/variant/${encodeURIComponent(hgvs)}`, MYVARIANT_BASE);
    url.searchParams.set("fields", "dbnsfp.revel,dbnsfp.alphamissense");
    const data = await fetchJson<Record<string, unknown>>(url);
    const dbnsfp = data.dbnsfp as Record<string, unknown> | undefined;
    const revel = dbnsfp?.revel as Record<string, unknown> | undefined;
    const alphaMissense = dbnsfp?.alphamissense as Record<string, unknown> | undefined;
    const revelScore = readNumber(revel, ["score"]);
    const alphaMissenseScore = readNumber(alphaMissense, ["score"]);
    if (revelScore === undefined && alphaMissenseScore === undefined) {
      return {
        status: "not_found",
        sourceLink: `${MYVARIANT_BASE}/variant/${encodeURIComponent(hgvs)}`,
        reviewLinks: [{ label: "MyVariant.info record", url: `${MYVARIANT_BASE}/variant/${encodeURIComponent(hgvs)}` }],
        caveat: "No REVEL or AlphaMissense computational prediction score was found for this variant.",
      };
    }
    return {
      status: "available",
      revelScore,
      alphaMissenseScore,
      alphaMissensePrediction: readString(alphaMissense, ["pred", "prediction"]),
      predictor: revelScore !== undefined ? "REVEL" : "AlphaMissense",
      sourceLink: `${MYVARIANT_BASE}/variant/${encodeURIComponent(hgvs)}`,
      reviewLinks: [{ label: "MyVariant.info record", url: `${MYVARIANT_BASE}/variant/${encodeURIComponent(hgvs)}` }],
      caveat: "Computational missense prediction supports ACMG/AMP PP3 (supporting pathogenic) or BP4 (supporting benign) depending on the score threshold used.",
      raw: data,
    };
  } catch (error) {
    return {
      status: "query_failed",
      sourceLink: myVariantSiteLink,
      reviewLinks: [{ label: "MyVariant.info home", url: myVariantSiteLink }],
      caveat: `MyVariant.info/dbNSFP could not be queried at this time: ${errorMessage(error)}`,
    };
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
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readSampleLevelEvidence(mutation: Record<string, unknown>) {
  const tumorAltCount = readNumber(mutation, ["tumorAltCount"]);
  const tumorRefCount = readNumber(mutation, ["tumorRefCount"]);
  const vaf = tumorAltCount != null && tumorRefCount != null && tumorAltCount + tumorRefCount > 0
    ? tumorAltCount / (tumorAltCount + tumorRefCount)
    : undefined;
  return {
    sampleId: readString(mutation, ["sampleId"]) ?? "Unknown sample",
    mutationStatus: readString(mutation, ["mutationStatus"]),
    vaf,
  };
}

function readSampleCount(sampleList: unknown) {
  return readNumber(sampleList, ["sampleCount", "allSampleCount", "sequencedSampleCount"])
    ?? parseCountFromText(readString(sampleList, ["description", "name"]));
}

function parseCountFromText(value?: string) {
  const match = value?.match(/\(([\d,]+)\s+samples?\)/i) ?? value?.match(/([\d,]+)\s+samples?/i);
  return match ? Number(match[1].replace(/,/g, "")) || undefined : undefined;
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, operation: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await operation(items[index]);
    }
  });
  await Promise.all(workers);
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
    status: "query_failed",
    matchingStudies: [],
    tumorTypes: [],
    matchingProteinChanges: [],
    queriedStudies,
    sourceLink: `${CBIO_BASE}/`,
    reviewLinks: [{ label: "cBioPortal studies", url: `${CBIO_BASE}/datasets` }],
    caveat: message,
  };
}

function notFoundCbio(message: string, queriedStudies: CbioPortalResult["queriedStudies"]): CbioPortalResult {
  return {
    status: "not_found",
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
  const term = clinvarCoordinateTerm(variant);
  return `https://www.ncbi.nlm.nih.gov/clinvar/?term=${encodeURIComponent(term)}`;
}

function oncokbReviewLink(gene: string, alteration?: string) {
  const suffix = alteration ? `/${encodeURIComponent(alteration)}` : "";
  return `https://www.oncokb.org/gene/${encodeURIComponent(gene)}${suffix}`;
}

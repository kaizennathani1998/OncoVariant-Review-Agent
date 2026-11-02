import type { GenomeBuild, NormalizedVariant, VariantReviewRequest } from "./types";
import { proteinChangeCandidates, normalizeProteinChange, mapReferenceGenome, isProteinMatch } from "./parsers.mjs";
import { fetchJson } from "./http.ts";
import { resolveRefSeqTranscript } from "./sources.ts";
import { normalizeDisease } from "./disease.ts";
import { parseVaf } from "./vaf.ts";

const VALID_BUILDS: GenomeBuild[] = ["hg19", "hg38"];
const ENSEMBL_BASE = "https://rest.ensembl.org";
const REFSEQ_CHROMOSOME_ACCESSIONS: Record<GenomeBuild, Record<string, string>> = {
  hg19: {
    chr17: "NC_000017.10",
  },
  hg38: {
    chr17: "NC_000017.11",
  },
};

export function normalizeChromosome(chrom: string) {
  const withoutPrefix = chrom.trim().replace(/^chr/i, "");
  return `chr${withoutPrefix.toUpperCase()}`;
}

function classifyVariantType(ref: string, alt: string): "SNV" | "insertion" | "deletion" | "indel" | "unknown" {
  if (!ref || !alt) return "unknown";
  if (ref.length === 1 && alt.length === 1 && ref !== "-" && alt !== "-") return "SNV";
  if ((ref === "-" || ref.length === 0) && alt.length >= 1) return "insertion";
  if ((alt === "-" || alt.length === 0) && ref.length >= 1) return "deletion";
  if (ref.length !== alt.length) return "indel";
  return "unknown";
}

/**
 * Fetches the reference-genome sequence at the submitted position/length from Ensembl and
 * compares it against the submitted reference allele. This check runs BEFORE any
 * downstream source (ClinVar/OncoKB/cBioPortal/gnomAD/computational-prediction) is queried:
 * a mismatch means the submitted coordinate/allele pair does not describe a real genomic
 * position, so querying external sources with it would silently return meaningless results.
 */
async function validateReferenceAllele(
  chrom: string,
  pos: number,
  ref: string,
  build: GenomeBuild,
): Promise<{ ok: boolean; expected?: string; message?: string }> {
  if (ref === "-" || ref.length === 0) {
    // Pure insertion: there is no reference span to validate against.
    return { ok: true };
  }
  const assembly = mapReferenceGenome(build);
  const chromNumber = chrom.replace(/^chr/i, "");
  const end = pos + ref.length - 1;
  const url = new URL(`/sequence/region/human/${chromNumber}:${pos}-${end}:1`, ENSEMBL_BASE);
  url.searchParams.set("content-type", "application/json");
  url.searchParams.set("coord_system_version", assembly);
  try {
    const data = await fetchJson<{ seq?: string }>(url, undefined, 15000);
    const expected = data.seq?.toUpperCase();
    if (!expected) {
      return { ok: true, message: "Ensembl returned no sequence to validate the reference allele against; proceeding without this check." };
    }
    if (expected !== ref.toUpperCase()) {
      return { ok: false, expected, message: `Submitted reference allele "${ref}" does not match the ${build} (${assembly}) reference sequence "${expected}" at ${chrom}:${pos}-${end}.` };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: true, message: `Reference-allele validation could not be performed (Ensembl sequence lookup failed: ${message}); proceeding without this check.` };
  }
}

type VepAnnotation = {
  strand?: 1 | -1;
  canonicalTranscript?: string;
  codingHgvs?: string;
  proteinHgvs?: string;
  spdi?: string;
  variantType?: "SNV" | "insertion" | "deletion" | "indel" | "unknown";
  submittedProteinChange?: string;
};

async function fetchVepAnnotation(genomicHgvs: string, build: GenomeBuild): Promise<VepAnnotation | undefined> {
  try {
    const server = build === "hg19" ? "https://grch37.rest.ensembl.org" : ENSEMBL_BASE;
    const url = new URL(`/vep/human/hgvs/${encodeURIComponent(genomicHgvs)}`, server);
    url.searchParams.set("content-type", "application/json");
    url.searchParams.set("hgvs", "1");
    url.searchParams.set("protein", "1");
    const data = await fetchJson<Array<Record<string, unknown>>>(url, undefined, 15000);
    const entry = data[0] as Record<string, unknown> | undefined;
    if (!entry) return undefined;
    const transcriptConsequences = (entry.transcript_consequences as Array<Record<string, unknown>> | undefined) ?? [];
    const canonical = transcriptConsequences.find((t) => t.canonical === 1 || t.canonical === true) ?? transcriptConsequences[0];
    const strandValue = canonical?.strand;
    const strand: 1 | -1 | undefined = strandValue === 1 || strandValue === -1 ? strandValue : undefined;
    const variantClass = String(entry.variant_class ?? "");
    const variantType: VepAnnotation["variantType"] =
      variantClass === "SNV" ? "SNV" : variantClass === "insertion" ? "insertion" : variantClass === "deletion" ? "deletion" : variantClass === "indel" ? "indel" : undefined;
    return {
      strand,
      canonicalTranscript: typeof canonical?.transcript_id === "string" ? canonical.transcript_id : undefined,
      codingHgvs: typeof canonical?.hgvsc === "string" ? canonical.hgvsc : undefined,
      proteinHgvs: typeof canonical?.hgvsp === "string" ? canonical.hgvsp : undefined,
      spdi: typeof entry.spdi === "string" ? entry.spdi : undefined,
      variantType,
    };
  } catch {
    return undefined;
  }
}

export async function normalizeVariant(input: VariantReviewRequest): Promise<NormalizedVariant> {
  const chrom = normalizeChromosome(input.chrom);
  const pos = Number(input.pos);
  const ref = input.ref.trim().toUpperCase();
  const alt = input.alt.trim().toUpperCase();
  const build = input.build;

  if (!Number.isInteger(pos) || pos < 1) throw new Error("Position must be a positive integer.");
  if (!ref || !alt) throw new Error("Reference and alternate alleles are required.");
  if (!VALID_BUILDS.includes(build)) throw new Error("Genome build must be hg19 or hg38.");

  const gene = cleanOptional(input.gene);
  const disease = cleanOptional(input.disease) ?? cleanOptional(input.cancerType);
  const vafResult = parseVaf(input.vaf);
  const warnings: string[] = [];
  if (input.vaf !== undefined && input.vaf !== "" && !vafResult.ok) warnings.push(vafResult.error);
  if (input.disease) {
    const concept = normalizeDisease(input.disease);
    if (concept && !concept.ontologyId) warnings.push(`Submitted disease "${input.disease}" did not match a curated disease-concept alias; it is used as free text and disease-specific matching confidence is reduced.`);
  }

  const referenceCheck = await validateReferenceAllele(chrom, pos, ref, build);
  if (referenceCheck.message) warnings.push(referenceCheck.message);

  if (!referenceCheck.ok) {
    return {
      status: "failed",
      reason: "reference_allele_mismatch",
      chrom,
      pos,
      ref,
      alt,
      submittedReference: ref,
      expectedReference: referenceCheck.expected,
      build,
      genomicHgvs: `${chrom}:g.${pos}${ref}>${alt}`,
      ucscUrls: {
        hg19: ucscBrowserUrlForCoordinate({ chrom, pos, build: "hg19" }),
        hg38: ucscBrowserUrlForCoordinate({ chrom, pos, build: "hg38" }),
      },
      liftover: { status: "unavailable", message: "Liftover was skipped because the submitted reference allele did not match the reference genome." },
      gene,
      proteinChangeCandidates: input.proteinChange ? proteinChangeCandidates(input.proteinChange) : [],
      submittedProteinChange: cleanOptional(input.proteinChange),
      variantType: classifyVariantType(ref, alt),
      cancerType: cleanOptional(input.cancerType),
      disease,
      specimenMaterial: input.specimenMaterial,
      vaf: vafResult.ok ? vafResult.fraction : undefined,
      warnings: [referenceCheck.message ?? `Submitted reference allele "${ref}" does not match the ${build} reference sequence at ${chrom}:${pos}.`],
    };
  }

  const primaryCoordinate = { chrom, pos, build };
  const genomicHgvs = `${chrom}:g.${pos}${ref}>${alt}`;
  const [lifted, refSeqTranscript, vepAnnotation] = await Promise.all([
    liftCoordinate(chrom, pos, build),
    gene ? resolveRefSeqTranscript(gene) : Promise.resolve(undefined),
    fetchVepAnnotation(genomicHgvs, build),
  ]);
  const hg19 = build === "hg19" ? primaryCoordinate : lifted.coordinate;
  const hg38 = build === "hg38" ? primaryCoordinate : lifted.coordinate;
  const normalizedProteinChange = input.proteinChange ? normalizeProteinChange(input.proteinChange) : undefined;
  const variantType = vepAnnotation?.variantType ?? classifyVariantType(ref, alt);
  const grch37Hgvs = build === "hg19" ? accessionGenomicHgvs({ chrom, pos, build }, ref, alt) : hg19 ? accessionGenomicHgvs(hg19, ref, alt) : undefined;
  const grch38Hgvs = build === "hg38" ? accessionGenomicHgvs({ chrom, pos, build }, ref, alt) : hg38 ? accessionGenomicHgvs(hg38, ref, alt) : undefined;
  const codingHgvs = normalizeTranscriptHgvs(vepAnnotation?.codingHgvs, refSeqTranscript);
  const proteinHgvs = normalizeProteinHgvs(vepAnnotation?.proteinHgvs);

  let proteinChangeMatchesInput: boolean | undefined;
  if (input.proteinChange && proteinHgvs) {
    const candidates = proteinChangeCandidates(input.proteinChange);
    proteinChangeMatchesInput = isProteinMatch(proteinHgvs, candidates).matched;
    if (proteinChangeMatchesInput === false) {
      warnings.push(`Submitted protein change "${input.proteinChange}" does not match the Ensembl-derived protein consequence "${proteinHgvs}" for the submitted genomic coordinate/allele; verify the submitted protein change against the coordinate before clinical use.`);
    }
  }

  if (!vepAnnotation) {
    warnings.push("Ensembl VEP annotation could not be retrieved; strand, coding/protein HGVS, SPDI, and variant-type-from-VEP fields are unavailable and variant type was inferred from the submitted alleles only.");
  }

  return {
    status: "ok",
    chrom,
    pos,
    ref,
    alt,
    build,
    genomicHgvs,
    grch37Hgvs,
    grch38Hgvs,
    hg19: hg19?.build === "hg19" ? hg19 : undefined,
    hg38: hg38?.build === "hg38" ? hg38 : undefined,
    ucscUrls: {
      hg19: ucscBrowserUrlForCoordinate(hg19?.build === "hg19" ? hg19 : { chrom, pos, build: "hg19" }),
      hg38: ucscBrowserUrlForCoordinate(hg38?.build === "hg38" ? hg38 : { chrom, pos, build: "hg38" }),
    },
    liftover: {
      status: lifted.status,
      message: lifted.message,
    },
    gene,
    proteinChange: cleanOptional(input.proteinChange),
    normalizedProteinChange,
    proteinChangeCandidates: input.proteinChange ? proteinChangeCandidates(input.proteinChange) : [],
    submittedProteinChange: cleanOptional(input.proteinChange),
    proteinChangeMatchesInput,
    refSeqTranscript,
    canonicalTranscript: vepAnnotation?.canonicalTranscript,
    codingHgvs,
    proteinHgvs,
    strand: vepAnnotation?.strand,
    spdi: vepAnnotation?.spdi,
    variantType,
    cancerType: cleanOptional(input.cancerType),
    disease,
    specimenMaterial: input.specimenMaterial,
    vaf: vafResult.ok ? vafResult.fraction : undefined,
    warnings,
  };
}

export function ucscBrowserUrl(variant: NormalizedVariant) {
  return variant.ucscUrls[variant.build];
}

export function ucscBrowserUrlForCoordinate(coordinate: { chrom: string; pos: number; build: GenomeBuild }) {
  const start = Math.max(1, coordinate.pos - 50);
  const end = coordinate.pos + 50;
  const position = `${coordinate.chrom}:${start}-${end}`;
  const clinvarTrack = coordinate.build === "hg38" ? "clinvarMain=pack" : "clinvar=pack";
  return `https://genome.ucsc.edu/cgi-bin/hgTracks?db=${coordinate.build}&position=${encodeURIComponent(position)}&${clinvarTrack}&snp151=pack&knownGene=pack`;
}

function cleanOptional(value?: string) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function accessionGenomicHgvs(coordinate: { chrom: string; pos: number; build: GenomeBuild }, ref: string, alt: string) {
  const accession = REFSEQ_CHROMOSOME_ACCESSIONS[coordinate.build][coordinate.chrom];
  const prefix = accession ?? coordinate.chrom;
  return `${prefix}:g.${coordinate.pos}${ref}>${alt}`;
}

function normalizeTranscriptHgvs(value: string | undefined, refSeqTranscript: string | undefined) {
  if (!value) return undefined;
  const suffix = value.match(/:(c\..+)$/)?.[1];
  if (suffix && refSeqTranscript) return `${refSeqTranscript}:${suffix}`;
  return value;
}

function normalizeProteinHgvs(value: string | undefined) {
  if (!value) return undefined;
  return value.match(/:(p\..+)$/)?.[1] ?? value;
}

async function liftCoordinate(chrom: string, pos: number, build: GenomeBuild): Promise<{
  status: "exact" | "estimated" | "unavailable";
  message: string;
  coordinate?: { chrom: string; pos: number; build: GenomeBuild };
}> {
  const targetBuild: GenomeBuild = build === "hg19" ? "hg38" : "hg19";
  const fromAssembly = mapReferenceGenome(build);
  const toAssembly = mapReferenceGenome(targetBuild);
  const chromNumber = chrom.replace(/^chr/i, "");
  const region = `${chromNumber}:${pos}-${pos}`;

  const url = new URL(`/map/human/${fromAssembly}/${region}/${toAssembly}`, ENSEMBL_BASE);
  url.searchParams.set("content-type", "application/json");

  try {
    let data: { mappings?: Array<{ mapped?: { seq_region_name?: string; start?: number; end?: number } }> };
    try {
      data = await fetchJson(url, undefined, 20000);
    } catch {
      data = await fetchJson(url, undefined, 20000);
    }
    const mappings = data.mappings ?? [];
    const mapped = mappings[0]?.mapped;
    if (!mapped?.seq_region_name || typeof mapped.start !== "number") {
      return {
        status: "unavailable",
        message: `Ensembl returned no ${targetBuild} mapping for ${chrom}:${pos} ${build}.`,
      };
    }

    const isSingleBase = mapped.end === undefined || mapped.end === mapped.start;
    const status = mappings.length === 1 && isSingleBase ? "exact" : "estimated";
    return {
      status,
      message: `Coordinate lifted via Ensembl (${fromAssembly} to ${toAssembly}) for ${chrom}:${pos} ${build}.`,
      coordinate: { chrom: `chr${mapped.seq_region_name.replace(/^chr/i, "")}`, pos: mapped.start, build: targetBuild },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      status: "unavailable",
      message: `Ensembl liftover could not be queried at this time: ${message}.`,
    };
  }
}

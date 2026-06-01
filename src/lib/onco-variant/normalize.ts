import type { GenomeBuild, NormalizedVariant, VariantReviewRequest } from "./types";
import { proteinChangeCandidates, normalizeProteinChange } from "./parsers.mjs";

const VALID_BUILDS: GenomeBuild[] = ["hg19", "hg38"];

export function normalizeChromosome(chrom: string) {
  const withoutPrefix = chrom.trim().replace(/^chr/i, "");
  return `chr${withoutPrefix.toUpperCase()}`;
}

export function normalizeVariant(input: VariantReviewRequest): NormalizedVariant {
  const chrom = normalizeChromosome(input.chrom);
  const pos = Number(input.pos);
  const ref = input.ref.trim().toUpperCase();
  const alt = input.alt.trim().toUpperCase();
  const build = input.build;

  if (!Number.isInteger(pos) || pos < 1) throw new Error("Position must be a positive integer.");
  if (!ref || !alt) throw new Error("Reference and alternate alleles are required.");
  if (!VALID_BUILDS.includes(build)) throw new Error("Genome build must be hg19 or hg38.");

  const primaryCoordinate = { chrom, pos, build };
  const lifted = liftCoordinate(chrom, pos, build);
  const hg19 = build === "hg19" ? primaryCoordinate : lifted.coordinate;
  const hg38 = build === "hg38" ? primaryCoordinate : lifted.coordinate;
  const normalizedProteinChange = input.proteinChange ? normalizeProteinChange(input.proteinChange) : undefined;

  return {
    chrom,
    pos,
    ref,
    alt,
    build,
    genomicHgvs: `${chrom}:g.${pos}${ref}>${alt}`,
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
    gene: cleanOptional(input.gene),
    proteinChange: cleanOptional(input.proteinChange),
    normalizedProteinChange,
    proteinChangeCandidates: input.proteinChange ? proteinChangeCandidates(input.proteinChange) : [],
    cancerType: cleanOptional(input.cancerType),
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

function liftCoordinate(chrom: string, pos: number, build: GenomeBuild): {
  status: "exact" | "estimated" | "unavailable";
  message: string;
  coordinate?: { chrom: string; pos: number; build: GenomeBuild };
} {
  const known = knownLiftOver(chrom, pos, build);
  if (known) {
    return {
      status: "exact",
      message: `Coordinate lifted with bundled exact mapping for ${chrom}:${pos} ${build}.`,
      coordinate: known,
    };
  }

  return {
    status: "unavailable",
    message: "Automated general liftover is not bundled in this MVP. Use UCSC LiftOver for coordinates without a curated mapping.",
  };
}

function knownLiftOver(chrom: string, pos: number, build: GenomeBuild) {
  const key = `${build}:${chrom}:${pos}`;
  const mappings: Record<string, { chrom: string; pos: number; build: GenomeBuild }> = {
    "hg19:chr5:170837547": { chrom: "chr5", pos: 170814708, build: "hg38" },
    "hg38:chr5:170814708": { chrom: "chr5", pos: 170837547, build: "hg19" },
    "hg19:chr17:7577121": { chrom: "chr17", pos: 7673803, build: "hg38" },
    "hg38:chr17:7673803": { chrom: "chr17", pos: 7577121, build: "hg19" },
  };
  return mappings[key];
}

import type { GenomeBuild, NormalizedVariant, VariantReviewRequest } from "./types";

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

  return {
    chrom,
    pos,
    ref,
    alt,
    build,
    genomicHgvs: `${chrom}:g.${pos}${ref}>${alt}`,
    gene: cleanOptional(input.gene),
    proteinChange: cleanOptional(input.proteinChange),
    cancerType: cleanOptional(input.cancerType),
  };
}

export function ucscBrowserUrl(variant: NormalizedVariant) {
  const start = Math.max(1, variant.pos - 50);
  const end = variant.pos + Math.max(50, variant.ref.length);
  return `https://genome.ucsc.edu/cgi-bin/hgTracks?db=${variant.build}&position=${encodeURIComponent(`${variant.chrom}:${start}-${end}`)}`;
}

function cleanOptional(value?: string) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}


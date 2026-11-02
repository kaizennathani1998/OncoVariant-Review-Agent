import type { GenomeBuild } from "./types";

export const MAX_VCF_BYTES = 15 * 1024 * 1024;
export const MAX_VCF_RECORDS = 5_000;

export type ParsedVcfVariant = {
  key: string;
  recordIndex: number;
  alleleIndex: number;
  chrom: string;
  pos: number;
  id?: string;
  ref: string;
  alt: string;
  filter: string;
  passed: boolean;
  quality?: number;
  gene?: string;
  proteinChange?: string;
  codingChange?: string;
  consequence?: string;
  transcript?: string;
  vaf?: number;
  depth?: number;
  supported: boolean;
  unsupportedReason?: string;
};

export type VcfParseResult = {
  fileName?: string;
  detectedBuild: GenomeBuild | null;
  buildEvidence: string;
  sampleNames: string[];
  variants: ParsedVcfVariant[];
  stats: {
    records: number;
    alleles: number;
    passing: number;
    supported: number;
    unsupported: number;
    annotated: number;
  };
  warnings: string[];
};

type Annotation = {
  gene?: string;
  proteinChange?: string;
  codingChange?: string;
  consequence?: string;
  transcript?: string;
  impact?: string;
  canonical?: boolean;
};

export function parseVcf(text: string, fileName?: string): VcfParseResult {
  if (!text.trim()) throw new Error("The selected VCF is empty.");
  if (new TextEncoder().encode(text).byteLength > MAX_VCF_BYTES) {
    throw new Error(`VCF exceeds the ${Math.round(MAX_VCF_BYTES / 1024 / 1024)} MB upload limit.`);
  }

  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerLines: string[] = [];
  const dataLines: string[] = [];
  let columnHeader: string | undefined;

  for (const line of lines) {
    if (line.startsWith("##")) headerLines.push(line);
    else if (line.startsWith("#CHROM")) columnHeader = line;
    else if (line && !line.startsWith("#")) dataLines.push(line);
  }

  if (!columnHeader) throw new Error("Invalid VCF: the #CHROM column header is missing.");
  if (dataLines.length > MAX_VCF_RECORDS) {
    throw new Error(`VCF contains ${dataLines.length.toLocaleString()} records; the safe batch limit is ${MAX_VCF_RECORDS.toLocaleString()}.`);
  }

  const sampleNames = columnHeader.split("\t").slice(9);
  const { build, evidence } = detectBuild(headerLines);
  const csqFields = readCsqFields(headerLines);
  const warnings: string[] = [];
  if (!build) warnings.push("Genome build could not be determined from the VCF header. Select the correct build before review.");

  const variants: ParsedVcfVariant[] = [];
  dataLines.forEach((line, recordOffset) => {
    const columns = line.split("\t");
    if (columns.length < 8) {
      warnings.push(`Record ${recordOffset + 1} was skipped because it has fewer than eight VCF columns.`);
      return;
    }
    const [rawChrom, rawPos, rawId, ref, rawAlt, rawQual, filter, rawInfo, format, sample] = columns;
    const pos = Number(rawPos);
    if (!Number.isInteger(pos) || pos < 1) {
      warnings.push(`Record ${recordOffset + 1} was skipped because position "${rawPos}" is invalid.`);
      return;
    }
    const info = parseInfo(rawInfo);
    const alts = rawAlt.split(",");
    const csqAnnotations = parseCsqAnnotations(info.CSQ, csqFields);
    const funcAnnotations = parseOncomineAnnotations(info.FUNC);

    alts.forEach((alt, alleleIndex) => {
      const annotation = selectAnnotation(csqAnnotations, funcAnnotations, alt);
      const unsupportedReason = unsupportedVariantReason(ref, alt, info.SVTYPE);
      const sampleMetrics = parseSampleMetrics(format, sample, info, alleleIndex);
      variants.push({
        key: `${normalizeChrom(rawChrom)}:${pos}:${ref}:${alt}:${recordOffset + 1}:${alleleIndex}`,
        recordIndex: recordOffset + 1,
        alleleIndex,
        chrom: normalizeChrom(rawChrom),
        pos,
        id: rawId && rawId !== "." ? rawId : undefined,
        ref,
        alt,
        filter: filter || ".",
        passed: filter === "PASS" || filter === ".",
        quality: finiteNumber(rawQual),
        gene: annotation?.gene ?? info.GENE_NAME,
        proteinChange: annotation?.proteinChange,
        codingChange: annotation?.codingChange,
        consequence: annotation?.consequence ?? info.SVTYPE,
        transcript: annotation?.transcript,
        vaf: sampleMetrics.vaf,
        depth: sampleMetrics.depth,
        supported: !unsupportedReason,
        unsupportedReason,
      });
    });
  });

  const annotated = variants.filter((variant) => variant.gene || variant.proteinChange).length;
  return {
    fileName,
    detectedBuild: build,
    buildEvidence: evidence,
    sampleNames,
    variants,
    stats: {
      records: dataLines.length,
      alleles: variants.length,
      passing: variants.filter((variant) => variant.passed).length,
      supported: variants.filter((variant) => variant.supported).length,
      unsupported: variants.filter((variant) => !variant.supported).length,
      annotated,
    },
    warnings,
  };
}

function detectBuild(headers: string[]): { build: GenomeBuild | null; evidence: string } {
  const joined = headers.join("\n");
  const reference = headers.find((line) => /^##reference=/i.test(line));
  if (/\b(hg19|grch37|b37)\b/i.test(reference ?? joined)) {
    return { build: "hg19", evidence: reference ?? "VCF header contains a GRCh37/hg19 reference." };
  }
  if (/\b(hg38|grch38|b38)\b/i.test(reference ?? joined)) {
    return { build: "hg38", evidence: reference ?? "VCF header contains a GRCh38/hg38 reference." };
  }
  if (/##contig=<ID=chr1,length=249250621(?:,|>)/i.test(joined)) {
    return { build: "hg19", evidence: "chr1 length 249,250,621 matches GRCh37/hg19." };
  }
  if (/##contig=<ID=chr1,length=248956422(?:,|>)/i.test(joined)) {
    return { build: "hg38", evidence: "chr1 length 248,956,422 matches GRCh38/hg38." };
  }
  return { build: null, evidence: "No recognized reference or assembly-length signature was found." };
}

function readCsqFields(headers: string[]) {
  const csqHeader = headers.find((line) => /^##INFO=<ID=CSQ,/i.test(line));
  const format = csqHeader?.match(/Format:\s*([^">]+)/i)?.[1];
  return format?.split("|").map((field) => field.trim()) ?? [];
}

function parseInfo(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of raw.split(";")) {
    if (!entry) continue;
    const index = entry.indexOf("=");
    if (index === -1) result[entry] = "true";
    else result[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return result;
}

function parseCsqAnnotations(raw: string | undefined, fields: string[]): Array<Annotation & { allele?: string }> {
  if (!raw || !fields.length) return [];
  return raw.split(",").map((entry) => {
    const values = entry.split("|");
    const record = Object.fromEntries(fields.map((field, index) => [field, decodeVcfValue(values[index])]));
    return {
      allele: record.Allele,
      gene: record.SYMBOL,
      proteinChange: stripTranscript(record.HGVSp),
      codingChange: stripTranscript(record.HGVSc),
      consequence: record.Consequence?.replace(/&/g, ", "),
      transcript: record.Feature,
      impact: record.IMPACT,
      canonical: record.CANONICAL === "YES",
    };
  });
}

function parseOncomineAnnotations(raw: string | undefined): Annotation[] {
  if (!raw) return [];
  const objects = raw.match(/\{[^{}]+\}/g) ?? [];
  return objects.map((object) => {
    const values: Record<string, string> = {};
    const fieldPattern = /'([^']+)'\s*:\s*'([^']*)'/g;
    let match: RegExpExecArray | null;
    while ((match = fieldPattern.exec(object))) values[match[1]] = decodeVcfValue(match[2]) ?? "";
    return {
      gene: values.gene,
      proteinChange: values.protein,
      codingChange: values.coding,
      consequence: values.function ?? values.oncomineVariantClass,
      transcript: values.transcript,
      impact: values.function === "missense" ? "MODERATE" : undefined,
      canonical: Boolean(values.protein),
    };
  });
}

function selectAnnotation(
  csq: Array<Annotation & { allele?: string }>,
  oncomine: Annotation[],
  alt: string,
): Annotation | undefined {
  const alleleCsq = csq.filter((annotation) => !annotation.allele || annotation.allele === alt || annotation.allele === "-");
  const candidates = alleleCsq.length ? alleleCsq : csq.length ? csq : oncomine;
  const impactRank: Record<string, number> = { HIGH: 4, MODERATE: 3, LOW: 2, MODIFIER: 1 };
  return [...candidates].sort((a, b) => {
    const aScore = (a.canonical ? 100 : 0) + (a.proteinChange ? 20 : 0) + (impactRank[a.impact ?? ""] ?? 0);
    const bScore = (b.canonical ? 100 : 0) + (b.proteinChange ? 20 : 0) + (impactRank[b.impact ?? ""] ?? 0);
    return bScore - aScore;
  })[0];
}

function parseSampleMetrics(
  format: string | undefined,
  sample: string | undefined,
  info: Record<string, string>,
  alleleIndex: number,
) {
  const fields = format?.split(":") ?? [];
  const values = sample?.split(":") ?? [];
  const sampleRecord = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
  const af = indexedNumber(sampleRecord.AF ?? info.AF, alleleIndex);
  const depth = finiteNumber(sampleRecord.DP ?? sampleRecord.FDP ?? info.DP ?? info.FDP);
  if (af !== undefined) return { vaf: af > 1 && af <= 100 ? af / 100 : af, depth };

  const ad = (sampleRecord.AD ?? "").split(",").map(Number);
  if (ad.length > alleleIndex + 1 && ad.every(Number.isFinite)) {
    const total = ad.reduce((sum, value) => sum + value, 0);
    if (total > 0) return { vaf: ad[alleleIndex + 1] / total, depth: depth ?? total };
  }
  const altDepth = indexedNumber(sampleRecord.AO ?? sampleRecord.FAO ?? info.AO ?? info.FAO, alleleIndex);
  return { vaf: altDepth !== undefined && depth ? altDepth / depth : undefined, depth };
}

function unsupportedVariantReason(ref: string, alt: string, svType?: string) {
  if (svType && !/^(SNV|SNP|MNV|INDEL)$/i.test(svType)) return `${svType} records are retained for review but are not supported by the small-variant query engine.`;
  if (/[\[\]<>]/.test(alt)) return "Breakend and structural-variant alleles are retained for review but are not supported by the small-variant query engine.";
  if (!/^[ACGTN]+$/i.test(ref) || !/^[ACGTN]+$/i.test(alt)) return "Only sequence-resolved nucleotide alleles can be queried automatically.";
  return undefined;
}

function indexedNumber(value: string | undefined, index: number) {
  return finiteNumber(value?.split(",")[index]);
}

function finiteNumber(value: string | number | undefined) {
  if (value === undefined || value === "." || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stripTranscript(value?: string) {
  if (!value) return undefined;
  return value.includes(":") ? value.slice(value.indexOf(":") + 1) : value;
}

function decodeVcfValue(value?: string) {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeChrom(chrom: string) {
  return `chr${chrom.trim().replace(/^chr/i, "")}`;
}

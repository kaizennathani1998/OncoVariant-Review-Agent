import test from "node:test";
import assert from "node:assert/strict";
import { parseVcf } from "../src/lib/onco-variant/vcf.ts";

test("parses Mutect2/VEP annotations, build, VAF, and protein consequence", () => {
  const vcf = [
    "##fileformat=VCFv4.2",
    "##reference=GRCh38",
    "##INFO=<ID=CSQ,Number=.,Type=String,Description=\"Consequence annotations. Format: Allele|Consequence|IMPACT|SYMBOL|Feature|HGVSc|HGVSp|CANONICAL\">",
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tTUMOR",
    "chr17\t7674220\t.\tC\tT\t.\tPASS\tCSQ=T|missense_variant|MODERATE|TP53|NM_000546.6|NM_000546.6:c.524G>A|NP_000537.3:p.Arg175His|YES\tGT:AD:AF:DP\t0/1:58,42:0.42:100",
  ].join("\n");
  const result = parseVcf(vcf, "mutect.vcf");
  assert.equal(result.detectedBuild, "hg38");
  assert.equal(result.stats.supported, 1);
  assert.equal(result.variants[0].gene, "TP53");
  assert.equal(result.variants[0].proteinChange, "p.Arg175His");
  assert.equal(result.variants[0].codingChange, "c.524G>A");
  assert.equal(result.variants[0].vaf, 0.42);
});

test("parses Oncomine FUNC annotations and retains fusion breakends as unsupported", () => {
  const vcf = [
    "##fileformat=VCFv4.1",
    "##reference=hg19",
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE",
    "chr7\t138210102\tTRIM24-BRAF_1\tG\tG]chr7:140494267]\t.\tPASS\tSVTYPE=Fusion;GENE_NAME=TRIM24;FUNC=[{'gene':'TRIM24','exon':'5'}]\tGT:GQ\t./.:.",
    "chr15\t90631934\tCOSM41590\tC\tT\t9493.34\tPASS\tAF=0.4145;DP=3304;FUNC=[{'gene':'IDH2','coding':'c.419G>A','protein':'p.Arg140Gln','transcript':'NM_002168.4','function':'missense'}]\tGT:DP:AF\t0/1:3304:0.4145",
  ].join("\n");
  const result = parseVcf(vcf, "oncomine.vcf");
  assert.equal(result.detectedBuild, "hg19");
  assert.equal(result.stats.supported, 1);
  assert.equal(result.stats.unsupported, 1);
  assert.match(result.variants[0].unsupportedReason, /Fusion/);
  assert.equal(result.variants[1].gene, "IDH2");
  assert.equal(result.variants[1].proteinChange, "p.Arg140Gln");
  assert.equal(result.variants[1].vaf, 0.4145);
});

test("splits multi-allelic records and maps allele-specific AF values", () => {
  const vcf = [
    "##fileformat=VCFv4.2",
    "##contig=<ID=chr1,length=248956422>",
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tTUMOR",
    "chr1\t100\t.\tA\tC,G\t.\tPASS\tDP=100\tGT:AF:DP\t1/2:0.1,0.2:100",
  ].join("\n");
  const result = parseVcf(vcf);
  assert.equal(result.detectedBuild, "hg38");
  assert.equal(result.variants.length, 2);
  assert.deepEqual(result.variants.map((variant) => variant.vaf), [0.1, 0.2]);
});

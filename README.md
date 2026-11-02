# OncoLens AI

A production-oriented Next.js workspace for evidence-backed oncology variant review. It supports single-variant review and local VCF ingestion with progress-tracked multi-variant navigation.

## Capabilities

- Parallel evidence retrieval from ClinVar, OncoKB, cBioPortal, AACR GENIE, gnomAD, MyVariant/dbNSFP, CIViC, and the public COSMIC-derived NLM endpoint.
- Four separate deterministic outputs: germline significance, somatic oncogenicity, somatic clinical impact, and origin assessment.
- Optional AI narration generated after evidence is returned, so model latency does not block the results workspace.
- Local VCF parsing for Mutect2/VEP `CSQ` and Ion Reporter/Oncomine `FUNC` annotations, including build detection, gene/protein extraction, VAF/depth extraction, and multi-allelic splitting.
- Concurrency-limited, cancellable VCF review queues with per-variant result navigation.
- Structural/fusion records remain visible with an explicit unsupported reason; they are not silently submitted to small-variant evidence engines.
- Bounded upstream timeouts, shared cBioPortal metadata/mutation caches, response timing metadata, and `Server-Timing` headers.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Environment

```text
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=
ANTHROPIC_MODEL=claude-sonnet-5
ONCOKB_API_TOKEN=
NCBI_API_KEY=
```

The app still runs without keys. Missing or failed sources are explicitly labeled with structured source statuses such as `permission_denied`, `not_found`, or `query_failed`.

## API

```text
POST /api/review-variant
```

Example:

```json
{
  "chrom": "chr1",
  "pos": 36937059,
  "ref": "A",
  "alt": "G",
  "build": "hg19",
  "gene": "CSF3R"
}
```

Optional request controls:

```json
{
  "includeAiSummary": false,
  "includeRawEvidence": false
}
```

The GUI requests deterministic evidence first and generates the AI narrative separately. API responses include `queryMetadata` with normalization, evidence, classification, AI, and per-source timings.

## VCF workflow

Open **VCF batch**, choose an uncompressed `.vcf`, confirm the detected genome build, and enter the disease being reviewed. The file is parsed in the browser; only normalized variant fields are sent to the review API after **Review variants** is selected. Batches run two variants at a time to avoid overwhelming public evidence services.

Current safety limits are 15 MB and 5,000 VCF records. Sequence-resolved SNVs/indels are reviewable. Breakends, fusions, and other symbolic structural variants remain visible but require a dedicated structural-variant evidence workflow.

## Verification

```bash
npm test
npm run lint
npm run build
```

This is for research support only and not a standalone clinical interpretation.

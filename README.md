# OncoLens AI

A standalone Next.js MVP for AI-assisted oncology variant review.

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

The app still runs without keys. Missing or failed sources are clearly labeled as `missing-token`, `not-found`, or `mock`.

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

This is for research support only and not a standalone clinical interpretation.

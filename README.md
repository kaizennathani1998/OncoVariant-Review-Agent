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
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
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

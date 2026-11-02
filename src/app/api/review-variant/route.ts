import { NextRequest, NextResponse } from "next/server";
import { classifyVariant } from "@/lib/onco-variant/classification";
import { normalizeVariant, ucscBrowserUrl } from "@/lib/onco-variant/normalize";
import {
  queryCbioPortal,
  queryAacrGenie,
  queryCivic,
  queryClinVar,
  queryComputationalPrediction,
  queryCosmic,
  queryGnomad,
  queryOncoKb,
  buildPracticalImportPackage,
} from "@/lib/onco-variant/sources";
import type { ClassificationResult, ClinVarResult, CosmicResult, CivicResult, GenieResult, VariantReviewRequest, VariantReviewResponse } from "@/lib/onco-variant/types";

const DISCLAIMER = "This is for research support only and not a standalone clinical interpretation.";
const REQUIRED_SECTIONS = ["Germline significance", "Somatic oncogenicity", "Somatic clinical impact", "Origin assessment", "Source-specific caveats"];
const BANNED_PHRASES = [
  /\bI recommend\b/i,
  /\byou should\b/i,
  /\bprescribe\b/i,
  /\bstart treatment with\b/i,
  /\bwe advise\b/i,
  /\b(openai|chatgpt|gpt-?\d)\b/i,
  // Never let the four independent outputs be merged into a single combined verdict phrase.
  /\boncogenic tier\b/i,
  /\btier\s*[ivx]+\s*(oncogenic|pathogenic)\b/i,
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as VariantReviewRequest;
    const normalizedVariant = await normalizeVariant(body);
    const ucscUrl = ucscBrowserUrl(normalizedVariant);
    const ucscUrls = normalizedVariant.ucscUrls;

    if (normalizedVariant.status === "failed") {
      // Reference-allele mismatch: never query external sources with a coordinate/allele
      // pair that does not describe a real genomic position.
      const emptyClinvar: ClinVarResult = { status: "not_applicable", molecularConsequence: [], hgvsNames: [], populationFrequencies: [], crossReferences: [], caveat: "Not queried: reference-allele validation failed before any source query." };
      const emptyOncoKb = { status: "not_applicable" as const, therapeuticImplications: [], otherSignificantResistanceLevels: [], drugs: [], treatments: [], diagnosticImplications: [], prognosticImplications: [], citations: [] };
      const emptyCbioportal = { status: "not_applicable" as const, matchingStudies: [], tumorTypes: [], matchingProteinChanges: [], queriedStudies: [] };
      const emptyAacrGenie: GenieResult = { status: "not_applicable", registry: "AACR_GENIE", matchingStudies: [], tumorTypes: [], matchingProteinChanges: [], queriedStudies: [], caveat: "Not queried: reference-allele validation failed before any source query." };
      const emptyGnomad = { status: "not_applicable" as const, rsIds: [] };
      const emptyComputationalPrediction = { status: "not_applicable" as const };
      const emptyCivic: CivicResult = { status: "not_applicable", molecularProfiles: [], evidenceItems: [], caveat: "Not queried: reference-allele validation failed before any source query." };
      const emptyCosmic: CosmicResult = { status: "not_applicable", matches: [], caveat: "Not queried: reference-allele validation failed before any source query." };
      const classification = classifyVariant({
        normalizedVariant,
        clinvar: emptyClinvar,
        oncokb: emptyOncoKb,
        cbioportal: emptyCbioportal,
        gnomad: emptyGnomad,
        computationalPrediction: emptyComputationalPrediction,
      });
      const practicalImportPackage = buildPracticalImportPackage({
        normalizedVariant,
        clinvar: emptyClinvar,
        oncokb: emptyOncoKb,
        cbioportal: emptyCbioportal,
        aacrGenie: emptyAacrGenie,
        gnomad: emptyGnomad,
        computationalPrediction: emptyComputationalPrediction,
        civic: emptyCivic,
        cosmic: emptyCosmic,
      });
      const partial = {
        normalizedVariant,
        ucscUrl,
        ucscUrls,
        clinvar: emptyClinvar,
        oncokb: emptyOncoKb,
        cbioportal: emptyCbioportal,
        aacrGenie: emptyAacrGenie,
        gnomad: emptyGnomad,
        computationalPrediction: emptyComputationalPrediction,
        civic: emptyCivic,
        cosmic: emptyCosmic,
        practicalImportPackage,
        classification,
      };
      const aiSummary = `Classification could not proceed: the submitted reference allele "${normalizedVariant.submittedReference}" does not match the expected reference sequence "${normalizedVariant.expectedReference ?? "unknown"}" at the submitted coordinate. No external source was queried. ${DISCLAIMER}`;
      return NextResponse.json({ ...partial, aiSummary } satisfies VariantReviewResponse);
    }

    const [clinvar, oncokb, cbioportal, aacrGenie, gnomad, computationalPrediction, civic, cosmic] = await Promise.all([
      queryClinVar(normalizedVariant),
      queryOncoKb(normalizedVariant),
      queryCbioPortal(normalizedVariant),
      queryAacrGenie(normalizedVariant),
      queryGnomad(normalizedVariant),
      queryComputationalPrediction(normalizedVariant),
      queryCivic(normalizedVariant),
      queryCosmic(normalizedVariant),
    ]);
    const classification = classifyVariant({ normalizedVariant, clinvar, oncokb, cbioportal, gnomad, computationalPrediction });
    const practicalImportPackage = buildPracticalImportPackage({ normalizedVariant, clinvar, oncokb, cbioportal, aacrGenie, gnomad, computationalPrediction, civic, cosmic });
    const partial = { normalizedVariant, ucscUrl, ucscUrls, clinvar, oncokb, cbioportal, aacrGenie, gnomad, computationalPrediction, civic, cosmic, practicalImportPackage, classification };
    const aiSummary = await generateAiSummary(partial);
    return NextResponse.json({ ...partial, aiSummary } satisfies VariantReviewResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to review variant.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** Reachable = the source could in principle return usable data; unreachable/denied/rate-limited/not-applicable are not. */
function isReachable(status: string) {
  return status === "available" || status === "not_found" || status === "not_returned";
}

function buildDigest(result: Omit<VariantReviewResponse, "aiSummary">) {
  const variant = result.normalizedVariant;
  return {
    variant: {
      gene: variant.gene,
      proteinChange: variant.proteinChange,
      genomicHgvs: variant.genomicHgvs,
      cancerType: variant.cancerType,
      disease: variant.disease,
      specimenMaterial: variant.specimenMaterial,
      vaf: variant.vaf,
    },
    clinvar: {
      status: result.clinvar.status,
      germlineClassification: result.clinvar.germlineClassification,
      somaticClinicalImpact: result.clinvar.somaticClinicalImpact,
      oncogenicityClassification: result.clinvar.oncogenicityClassification,
      caveat: result.clinvar.caveat,
    },
    oncokb: {
      status: result.oncokb.status,
      oncogenicity: result.oncokb.oncogenicity,
      mutationEffect: result.oncokb.mutationEffect,
      caveat: result.oncokb.caveat,
    },
    practicalImportPackage: result.practicalImportPackage,
    aacrGenie: {
      status: result.aacrGenie.status,
      mutationCount: result.aacrGenie.mutationCount,
      caveat: result.aacrGenie.caveat,
    },
    civic: {
      status: result.civic.status,
      molecularProfiles: result.civic.molecularProfiles,
      caveat: result.civic.caveat,
    },
    cosmic: {
      status: result.cosmic.status,
      caveat: result.cosmic.caveat,
    },
    // Four independent outputs — always digested and presented as separate blocks, never
    // merged into a single verdict field.
    germlineSignificance: result.classification.germlineSignificance,
    somaticOncogenicity: result.classification.somaticOncogenicity,
    somaticClinicalImpact: result.classification.somaticClinicalImpact,
    originAssessment: result.classification.originAssessment,
    manualReviewFlags: result.classification.manualReviewFlags,
  };
}

async function generateAiSummary(result: Omit<VariantReviewResponse, "aiSummary">) {
  const fallback = deterministicSummary(result);
  if (!process.env.ANTHROPIC_API_KEY) {
    return `${fallback}\n\nClaude summary generation was skipped because ANTHROPIC_API_KEY is not configured. ${DISCLAIMER}`;
  }

  const digest = buildDigest(result);
  try {
    const baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
        system: "Four independent classification outputs have already been computed by deterministic rules engines and are given to you verbatim below: (1) germlineSignificance (ACMG/AMP 2015), (2) somaticOncogenicity (ClinGen-CGC-VICC / AMP-ASCO-CAP 2017), (3) somaticClinicalImpact (a per-axis therapeutic/diagnostic/prognostic disease-guideline lookup), and (4) originAssessment (a specimen-role lookup, never derived from VAF). Your job is to explain each verbatim, never to decide, merge, average, or cross-reference them into a single combined verdict or phrase — never write something like \"oncogenic Tier II\" or \"pathogenic and oncogenic\" as one phrase. Report each of the four sections separately, each under its own heading. Within germlineSignificance/somaticOncogenicity, externalAssertions (e.g. a ClinVar or OncoKB label) and internalComputation (the criteria-based score) are structurally distinct — state which one primaryClassification came from (classificationBasis) and never claim the internal computation reproduced an external label unless internalComputation.status is \"complete\" and it actually matches. If internalComputation.status is \"invalid\", state plainly that the computation was rejected due to incompatible criteria and no internally-computed score is being reported; do not silently substitute a number. List manualReviewFlags verbatim if present. Use only supplied source data; add no clinical claims, treatment recommendations, or external knowledge. Respond in plain prose with no markdown formatting (no #, *, or - characters for structure).",
        messages: [
          {
            role: "user",
            content: `Create a summary with plain-text section labels exactly as follows: Germline significance, Somatic oncogenicity, Somatic clinical impact, Origin assessment, Source-specific caveats. Each section covers only its own output — never combine two sections' conclusions into one sentence. Separate sections with a blank line. End with the research support disclaimer.\n\n${JSON.stringify(digest, null, 2)}`,
          },
        ],
        max_tokens: 1100,
      }),
    });

    if (!response.ok) {
      console.warn("Claude call failed", response.status, response.statusText);
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { content?: Array<{ type: string; text?: string }>; stop_reason?: string };
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      console.warn("Unexpected Claude response shape", JSON.stringify(data).slice(0, 500));
      return fallback;
    }
    if (data.stop_reason === "max_tokens") {
      console.warn("Claude response was truncated at max_tokens");
    }

    const guardrailFailure = checkGuardrail(text, result.classification);
    if (guardrailFailure) {
      console.warn("AI summary guardrail rejected response", guardrailFailure);
      return `${fallback}\n\nAI summary fallback used because the generated summary failed a safety check (${guardrailFailure}). ${DISCLAIMER}`;
    }

    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown Claude error";
    return `${fallback}\n\nAI summary fallback used because Claude generation failed: ${message}. ${DISCLAIMER}`;
  }
}

function checkGuardrail(text: string, classification: ClassificationResult): string | null {
  const missingSections = REQUIRED_SECTIONS.filter((section) => !text.includes(section));
  if (missingSections.length) {
    return `missing required section(s): ${missingSections.join(", ")}`;
  }

  const bannedMatch = BANNED_PHRASES.find((pattern) => pattern.test(text));
  if (bannedMatch) {
    return `contained a banned/merged-verdict phrase (${bannedMatch})`;
  }

  if (!text.includes(classification.germlineSignificance.primaryClassification)) {
    return `did not state the computed germline primary classification verbatim (${classification.germlineSignificance.primaryClassification})`;
  }
  if (!text.includes(classification.somaticOncogenicity.primaryClassification)) {
    return `did not state the computed oncogenicity primary classification verbatim (${classification.somaticOncogenicity.primaryClassification})`;
  }

  return null;
}

function describeSource(label: string, status: string, caveat: string | undefined, foundText: string) {
  if (!isReachable(status)) {
    return `${label} could not be reached${caveat ? `: ${caveat}` : "."}`;
  }
  if (status === "not_found") {
    return `${label} was reached but found no matching record.`;
  }
  return foundText;
}

function describeClinVarTracks(clinvar: ClinVarResult) {
  const tracks = [
    ["germline classification", clinvar.germlineClassification],
    ["somatic clinical impact", clinvar.somaticClinicalImpact],
    ["oncogenicity classification", clinvar.oncogenicityClassification],
  ] as const;
  const populated = tracks
    .filter(([, classification]) => classification?.description)
    .map(([label, classification]) => `${label} of ${classification!.description}${classification!.conditions.length ? ` for ${classification!.conditions.join(", ")}` : ""}`);
  if (!populated.length) return "ClinVar returned no classification in any of the germline, somatic clinical impact, or oncogenicity tracks.";
  return `ClinVar reports a ${populated.join(" and a ")}.`;
}

function describeGermline(result: Omit<VariantReviewResponse, "aiSummary">) {
  const g = result.classification.germlineSignificance;
  const notAssessedCount = g.internalComputation.criteriaNotAssessed.length;
  const totalCount = g.internalComputation.criteriaNotAssessed.length + g.internalComputation.criteriaMet.length + g.internalComputation.criteriaNotMet.length;
  return `Germline significance: primary classification is ${g.primaryClassification} (basis: ${g.classificationBasis}). Internal ACMG/AMP computation status: ${g.internalComputation.status}; ${notAssessedCount} of ${totalCount} assessed criteria could not be evaluated from available data. ${g.externalAssertions.length ? `External assertion(s): ${g.externalAssertions.map((a) => `${a.source} reports ${a.classification}`).join("; ")}.` : "No external germline assertion was found."}`;
}

function describeOncogenicity(result: Omit<VariantReviewResponse, "aiSummary">) {
  const o = result.classification.somaticOncogenicity;
  if (o.internalComputation.status === "invalid") {
    return `Somatic oncogenicity: primary classification is ${o.primaryClassification} (basis: ${o.classificationBasis}). The internal CGC-VICC computation was rejected as invalid (${o.internalComputation.validationErrors.join("; ")}); no internally-computed score is reported.`;
  }
  return `Somatic oncogenicity: primary classification is ${o.primaryClassification} (basis: ${o.classificationBasis}). Internal CGC-VICC computation status: ${o.internalComputation.status}, score ${o.internalComputation.score ?? "n/a"}. ${o.externalAssertions.length ? `External assertion(s): ${o.externalAssertions.map((a) => `${a.source} reports ${a.classification}`).join("; ")}.` : "No external oncogenicity assertion was found."}`;
}

function describeClinicalImpact(result: Omit<VariantReviewResponse, "aiSummary">) {
  return `Somatic clinical impact (each axis independent): ${result.classification.somaticClinicalImpact.axes.map((axis) => `${axis.axis}: ${axis.status}${axis.tier ? ` (${axis.tier})` : ""}`).join("; ")}.`;
}

function describeOrigin(result: Omit<VariantReviewResponse, "aiSummary">) {
  const origin = result.classification.originAssessment;
  return `Origin assessment: ${origin.conclusion} (specimen role: ${origin.specimenRole}). Germline not excluded: ${origin.germlineNotExcluded}.`;
}

function deterministicSummary(result: Omit<VariantReviewResponse, "aiSummary">) {
  const variant = result.normalizedVariant;
  const known = [
    describeSource("ClinVar", result.clinvar.status, result.clinvar.caveat, describeClinVarTracks(result.clinvar)),
    describeSource("OncoKB", result.oncokb.status, result.oncokb.caveat, result.oncokb.oncogenicity ? `OncoKB reports oncogenicity as: ${result.oncokb.oncogenicity}.` : "OncoKB did not return an oncogenicity field."),
    describeSource("cBioPortal", result.cbioportal.status, result.cbioportal.caveat, `cBioPortal returned ${result.cbioportal.mutationCount ?? result.cbioportal.matchingStudies.length} matching mutation/study finding(s).`),
  ].join(" ");

  return [
    `Germline significance: ${describeGermline(result)}`,
    `Somatic oncogenicity: ${describeOncogenicity(result)}`,
    `Somatic clinical impact: ${describeClinicalImpact(result)}`,
    `Origin assessment: ${describeOrigin(result)}`,
    `Source-specific caveats: ClinVar status is ${result.clinvar.status}; OncoKB status is ${result.oncokb.status}; cBioPortal status is ${result.cbioportal.status}; AACR GENIE status is ${result.aacrGenie.status}; gnomAD status is ${result.gnomad.status}; computational prediction status is ${result.computationalPrediction.status}; CIViC status is ${result.civic.status}; COSMIC status is ${result.cosmic.status}. Source data reviewed — ${known} ${variant.gene ?? ""} ${variant.genomicHgvs}. Clinical interpretation requires review by qualified clinical/molecular pathology professionals. ${DISCLAIMER}`,
  ].join("\n\n");
}

import { NextRequest, NextResponse } from "next/server";
import { normalizeVariant, ucscBrowserUrl } from "@/lib/onco-variant/normalize";
import { queryCbioPortal, queryClinVar, queryOncoKb } from "@/lib/onco-variant/sources";
import type { VariantReviewRequest, VariantReviewResponse } from "@/lib/onco-variant/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as VariantReviewRequest;
    const normalizedVariant = normalizeVariant(body);
    const ucscUrl = ucscBrowserUrl(normalizedVariant);
    const ucscUrls = normalizedVariant.ucscUrls;
    const [clinvar, oncokb, cbioportal] = await Promise.all([
      queryClinVar(normalizedVariant),
      queryOncoKb(normalizedVariant),
      queryCbioPortal(normalizedVariant),
    ]);
    const partial = { normalizedVariant, ucscUrl, ucscUrls, clinvar, oncokb, cbioportal };
    const aiSummary = await generateAiSummary(partial);
    return NextResponse.json({ ...partial, aiSummary } satisfies VariantReviewResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to review variant.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function generateAiSummary(result: Omit<VariantReviewResponse, "aiSummary">) {
  const fallback = deterministicSummary(result);
  if (!process.env.OPENAI_API_KEY) {
    return `${fallback}\n\nOpenAI summary generation was skipped because OPENAI_API_KEY is not configured. This is for research support only and not a standalone clinical interpretation.`;
  }
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: "Use only supplied source data. Do not add clinical claims, treatment recommendations, or external knowledge." }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: `Create a concise clinical-style summary with sections: What is known, What is uncertain, Clinical actionability, Source-specific caveats. End with the research support disclaimer.\n\n${JSON.stringify(result, null, 2)}` }],
          },
        ],
        max_output_tokens: 550,
      }),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = await response.json() as { output_text?: string };
    return data.output_text ?? fallback;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown OpenAI error";
    return `${fallback}\n\nAI summary fallback used because OpenAI generation failed: ${message}. This is for research support only and not a standalone clinical interpretation.`;
  }
}

function deterministicSummary(result: Omit<VariantReviewResponse, "aiSummary">) {
  const variant = result.normalizedVariant;
  const known = [
    result.clinvar.status === "not-found" ? "ClinVar exact record was not found." : result.clinvar.clinicalSignificance ? `ClinVar reports: ${result.clinvar.clinicalSignificance}.` : "ClinVar did not return a definitive clinical significance field.",
    result.oncokb.oncogenicity ? `OncoKB reports oncogenicity as: ${result.oncokb.oncogenicity}.` : "OncoKB did not return an oncogenicity field.",
    result.oncokb.therapeuticImplications.length ? `OncoKB reports therapeutic implications, including ${result.oncokb.drugs.join(", ") || "drug entries"} with evidence levels as returned by OncoKB.` : "OncoKB did not return treatment entries.",
    result.cbioportal.status === "live" ? `cBioPortal returned ${result.cbioportal.mutationCount ?? result.cbioportal.matchingStudies.length} matching mutation/study finding(s).` : result.cbioportal.status === "not-found" ? "cBioPortal did not find an exact match in the queried studies." : "cBioPortal was unavailable or could not be queried.",
  ].join(" ");
  const actionability = result.oncokb.therapeuticImplications.length || result.oncokb.drugs.length
    ? "OncoKB treatment entries indicate potential therapeutic relevance in the returned disease context; clinical use requires manual review of levels, labels, and disease setting."
    : "No therapy-level actionability is established from the returned source fields alone.";

  return [
    `What is known: ${variant.genomicHgvs}${variant.gene ? ` in ${variant.gene}` : ""} was reviewed against ClinVar, OncoKB, and cBioPortal. ${known}`,
    "What is uncertain: Source coverage may be incomplete, cancer type mapping may be approximate, and mock or fallback statuses must not be treated as evidence.",
    `Clinical actionability: ${actionability}`,
    `Source-specific caveats: ClinVar status is ${result.clinvar.status}; OncoKB status is ${result.oncokb.status}; cBioPortal status is ${result.cbioportal.status}. Clinical interpretation requires tumor type, disease context, and review by qualified clinical/molecular pathology professionals.`,
  ].join("\n\n");
}

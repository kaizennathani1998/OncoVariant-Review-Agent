import assert from "node:assert/strict";
import test from "node:test";
import { classifyVariant } from "../src/lib/onco-variant/classification.ts";
import { OncogenicityCompatibilityValidator } from "../src/lib/onco-variant/oncogenicity-validator.ts";
import { normalizeDisease, matchDisease } from "../src/lib/onco-variant/disease.ts";
import { inferSpecimenRole } from "../src/lib/onco-variant/specimen.ts";
import { parseVaf } from "../src/lib/onco-variant/vaf.ts";

function baseNormalizedVariant(overrides = {}) {
  return {
    status: "ok",
    chrom: "chr17",
    pos: 7578406,
    ref: "C",
    alt: "T",
    build: "hg19",
    genomicHgvs: "chr17:g.7578406C>T",
    ucscUrls: { hg19: "https://example.test/hg19", hg38: "https://example.test/hg38" },
    liftover: { status: "unavailable", message: "Not computed in this fixture." },
    proteinChangeCandidates: [],
    warnings: [],
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    normalizedVariant: baseNormalizedVariant(overrides.normalizedVariant),
    clinvar: {
      status: "not_applicable",
      molecularConsequence: [],
      hgvsNames: [],
      populationFrequencies: [],
      crossReferences: [],
      ...overrides.clinvar,
    },
    oncokb: {
      status: "not_applicable",
      therapeuticImplications: [],
      otherSignificantResistanceLevels: [],
      drugs: [],
      treatments: [],
      diagnosticImplications: [],
      prognosticImplications: [],
      citations: [],
      ...overrides.oncokb,
    },
    cbioportal: {
      status: "not_applicable",
      matchingStudies: [],
      tumorTypes: [],
      matchingProteinChanges: [],
      queriedStudies: [],
      ...overrides.cbioportal,
    },
    gnomad: {
      status: "not_applicable",
      rsIds: [],
      ...overrides.gnomad,
    },
    computationalPrediction: {
      status: "not_applicable",
      ...overrides.computationalPrediction,
    },
  };
}

test("all-missing-data fixture: every criterion not_assessed or unmet, both primaries VUS, never throws, four outputs always present and separate", () => {
  const result = classifyVariant(baseInput());

  assert.equal(result.germlineSignificance.primaryClassification, "VUS");
  assert.equal(result.somaticOncogenicity.primaryClassification, "VUS");
  assert.ok(
    [...result.germlineSignificance.internalComputation.criteriaMet, ...result.germlineSignificance.internalComputation.criteriaNotMet, ...result.germlineSignificance.internalComputation.criteriaNotAssessed].every(
      (c) => c.met === "not_assessed" || c.met === false,
    ),
  );
  assert.ok(
    [...result.somaticOncogenicity.internalComputation.criteriaMet, ...result.somaticOncogenicity.internalComputation.criteriaNotMet, ...result.somaticOncogenicity.internalComputation.criteriaNotAssessed].every(
      (c) => c.met === "not_assessed" || c.met === false,
    ),
  );

  // The four outputs must exist as fully independent top-level keys, never merged into one string/object.
  assert.ok(result.germlineSignificance);
  assert.ok(result.somaticOncogenicity);
  assert.ok(result.somaticClinicalImpact);
  assert.ok(result.originAssessment);
  assert.equal(result.somaticClinicalImpact.axes.length, 3);
});

test("TP53 p.R175H + AML + bone_marrow + VAF=0.42 regression fixture: external ClinVar assertions remain primary while internal ACMG/CGC engines stay incomplete; population rarity only supports PM2_Supporting/OP4, never OM4; no TP53-VCEP label anywhere", () => {
  const input = baseInput({
    normalizedVariant: {
      gene: "TP53",
      proteinChange: "p.R175H",
      variantType: "SNV",
      disease: "Acute myeloid leukemia",
      cancerType: "AML",
      specimenMaterial: "bone_marrow",
      vaf: 0.42,
    },
    clinvar: {
      status: "available",
      germlineClassification: { description: "Pathogenic", reviewStatus: "reviewed by expert panel", conditions: ["Li-Fraumeni syndrome"], lastEvaluated: "2023-01-01" },
      oncogenicityClassification: { description: "Oncogenic", reviewStatus: "reviewed by expert panel", conditions: ["Acute myeloid leukemia"], lastEvaluated: "2023-01-01" },
      molecularConsequence: ["missense variant"],
      sourceLink: "https://www.ncbi.nlm.nih.gov/clinvar/variation/12345/",
    },
    oncokb: {
      status: "available",
      oncogenicity: "Oncogenic",
      hotspot: true,
      mutationEffect: "Loss-of-function",
      mutationEffectDescription: "Dominant-negative effect on the p53 tetramer.",
    },
    gnomad: {
      status: "available",
      alleleFrequency: 0.000002,
      popmaxFrequency: 0.000002,
      rsIds: ["rs28934578"],
    },
    computationalPrediction: {
      status: "available",
      revelScore: 0.9,
      predictor: "REVEL",
    },
  });

  const result = classifyVariant(input);

  // (B) Somatic oncogenicity: the generic hotspot flag no longer triggers OM1, and
  // population rarity no longer triggers OM4. OP4 may fire after successful population query.
  const onco = result.somaticOncogenicity;
  assert.equal(onco.internalComputation.status, "incomplete");
  assert.equal(onco.internalComputation.classification, "VUS");
  const om1 = onco.internalComputation.criteriaNotAssessed.find((c) => c.code === "OM1");
  assert.equal(om1.met, "not_assessed");
  assert.match(om1.reason, /generic hotspot flag is not sufficient/);
  const om4 = onco.internalComputation.criteriaNotAssessed.find((c) => c.code === "OM4");
  assert.equal(om4.met, "not_assessed");
  assert.match(om4.reason, /population rarity is not evidence for OM4/);
  const op4 = onco.internalComputation.criteriaMet.find((c) => c.code === "OP4");
  assert.equal(op4.met, true);
  const ovs1 = onco.internalComputation.criteriaNotApplicable.find((c) => c.code === "OVS1");
  assert.equal(ovs1.met, "not_applicable");
  const om2 = onco.internalComputation.criteriaNotApplicable.find((c) => c.code === "OM2");
  assert.equal(om2.met, "not_applicable");
  const sbp2 = onco.internalComputation.criteriaNotApplicable.find((c) => c.code === "SBP2");
  assert.equal(sbp2.met, "not_applicable");

  // Because the internal computation is incomplete, the highest-authority external oncogenicity assertion becomes primary.
  assert.equal(onco.classificationBasis, "external_curated_assertion");
  assert.equal(onco.primaryClassification, "Oncogenic");
  assert.equal(onco.externalAssertions.length, 2); // ClinVar oncogenicity track + OncoKB oncogenicity label
  assert.ok(onco.externalAssertions.some((a) => a.source === "ClinVar" && a.track === "oncogenicity"));
  assert.ok(onco.externalAssertions.some((a) => a.source === "OncoKB" && a.track === "oncogenicity"));

  // (A) Germline: PS1/PP5 must never fire from the ClinVar record; the ClinVar germline
  // Pathogenic assertion appears ONLY in externalAssertions, never converted into a criterion.
  const germ = result.germlineSignificance;
  assert.equal(germ.externalAssertions.length, 1);
  assert.equal(germ.externalAssertions[0].source, "ClinVar");
  assert.equal(germ.externalAssertions[0].classification, "Pathogenic");
  assert.equal(germ.classificationBasis, "external_curated_assertion");
  assert.equal(germ.primaryClassification, "Pathogenic");
  const pm2 = germ.internalComputation.criteriaMet.find((c) => c.code === "PM2");
  assert.equal(pm2.strength, "supporting");
  const pvs1 = germ.internalComputation.criteriaNotApplicable.find((c) => c.code === "PVS1");
  assert.equal(pvs1.met, "not_applicable");
  const pm4 = germ.internalComputation.criteriaNotApplicable.find((c) => c.code === "PM4");
  assert.equal(pm4.met, "not_applicable");
  const bp3 = germ.internalComputation.criteriaNotApplicable.find((c) => c.code === "BP3");
  assert.equal(bp3.met, "not_applicable");
  const bp7 = germ.internalComputation.criteriaNotApplicable.find((c) => c.code === "BP7");
  assert.equal(bp7.met, "not_applicable");
  const ps1 = germ.internalComputation.criteriaNotAssessed.find((c) => c.code === "PS1");
  assert.equal(ps1.met, "not_assessed");
  assert.match(ps1.reason, /independently established/);
  const pp5 = germ.internalComputation.criteriaSuppressed.find((c) => c.code === "PP5");
  assert.equal(pp5.met, "not_assessed");
  assert.match(pp5.reason, /permanently disabled/);
  const bp6 = germ.internalComputation.criteriaSuppressed.find((c) => c.code === "BP6");
  assert.equal(bp6.met, "not_assessed");

  // (C) Somatic clinical impact: prognostic axis matches the generic ELN 2022 AML TP53-adverse
  // rule (not ClinGen TP53 VCEP) because gene=TP53 and disease=AML; therapeutic axis is always
  // applicability_not_fully_assessable because no treatment context exists in the request model.
  const prognostic = result.somaticClinicalImpact.axes.find((a) => a.axis === "prognostic");
  assert.equal(prognostic.status, "tier_assigned");
  assert.equal(prognostic.matchedRule, "ELN_2022_INTENSIVE_TP53_ADVERSE");
  assert.equal(prognostic.applicabilityStatus, "context_incomplete");
  assert.deepEqual(prognostic.conditionsMissing, ["treatment_context"]);
  const diagnostic = result.somaticClinicalImpact.axes.find((a) => a.axis === "diagnostic");
  assert.equal(diagnostic.status, "applicability_not_fully_assessable");
  assert.equal(diagnostic.tier, "Tier_I");
  assert.deepEqual(diagnostic.conditionsMissing, ["blast_percentage", "complete_molecular_context", "diagnostic_hierarchy"]);
  const therapeutic = result.somaticClinicalImpact.axes.find((a) => a.axis === "therapeutic");
  assert.equal(therapeutic.status, "applicability_not_fully_assessable");

  // (D) Origin: bone marrow + AML (hematologic) -> disease_specimen, germline not excluded,
  // VAF 0.42 lands in the ambiguous heterozygous/near-clonal band and is surfaced as a caveat
  // that explicitly does not change the conclusion.
  const origin = result.originAssessment;
  assert.equal(origin.specimenRole, "disease_specimen");
  assert.equal(origin.conclusion, "presumed_disease_associated_somatic");
  assert.equal(origin.germlineNotExcluded, true);
  assert.ok(origin.caveats.some((c) => /does not change the origin conclusion/.test(c)));

  // Hard constraint: nothing anywhere in the four outputs claims TP53-VCEP compliance, and
  // the four outputs are returned as four distinct top-level keys, never concatenated.
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /VCEP/i);
  assert.doesNotMatch(serialized, /ClinGen TP53/i);
  assert.ok(Object.keys(result).includes("germlineSignificance"));
  assert.ok(Object.keys(result).includes("somaticOncogenicity"));
  assert.ok(Object.keys(result).includes("somaticClinicalImpact"));
  assert.ok(Object.keys(result).includes("originAssessment"));
});

test("common-benign fixture: high gnomAD population frequency triggers BA1 stand-alone -> Benign germline classification via internal computation (no external assertions present)", () => {
  const result = classifyVariant(
    baseInput({
      gnomad: { status: "available", alleleFrequency: 0.12, popmaxFrequency: 0.12, rsIds: ["rs1234"] },
    }),
  );
  const ba1 = result.germlineSignificance.internalComputation.criteriaMet.find((c) => c.code === "BA1");
  assert.ok(ba1);
  assert.equal(ba1.met, true);
  assert.equal(result.germlineSignificance.classificationBasis, "internal_computation");
  assert.equal(result.germlineSignificance.primaryClassification, "Benign");
});

test("PM2 is supporting by default and benign population thresholds use the correct direction in false rationales", () => {
  const result = classifyVariant(
    baseInput({
      gnomad: { status: "available", alleleFrequency: 0.0000254, popmaxFrequency: 0.0000254, rsIds: [] },
    }),
  );
  const pm2 = result.germlineSignificance.internalComputation.criteriaMet.find((c) => c.code === "PM2");
  assert.equal(pm2.met, true);
  assert.equal(pm2.strength, "supporting");
  const ba1 = result.germlineSignificance.internalComputation.criteriaNotMet.find((c) => c.code === "BA1");
  assert.equal(ba1.met, false);
  assert.match(ba1.rationale, /below the BA1/);

  const sbvs1 = result.somaticOncogenicity.internalComputation.criteriaNotMet.find((c) => c.code === "SBVS1");
  assert.equal(sbvs1.met, false);
  assert.match(sbvs1.rationale, /below the SBVS1/);
  const sbs1 = result.somaticOncogenicity.internalComputation.criteriaNotMet.find((c) => c.code === "SBS1");
  assert.equal(sbs1.met, false);
  assert.match(sbs1.rationale, /below the SBS1/);
});

test("PS1 and OS1/OS3 never read the variant's own external classification (non-circularity): they stay not_assessed regardless of ClinVar/OncoKB labels", () => {
  const result = classifyVariant(
    baseInput({
      clinvar: {
        status: "available",
        germlineClassification: { description: "Pathogenic", conditions: [] },
        oncogenicityClassification: { description: "Oncogenic", conditions: [] },
      },
      oncokb: { status: "available", oncogenicity: "Oncogenic" },
    }),
  );
  const ps1 = result.germlineSignificance.internalComputation.criteriaNotAssessed.find((c) => c.code === "PS1");
  assert.equal(ps1.met, "not_assessed");
  const os1 = result.somaticOncogenicity.internalComputation.criteriaNotAssessed.find((c) => c.code === "OS1");
  const os3 = result.somaticOncogenicity.internalComputation.criteriaNotAssessed.find((c) => c.code === "OS3");
  assert.equal(os1.met, "not_assessed");
  assert.equal(os3.met, "not_assessed");
});

test("PP5/BP6 are permanently disabled for every fixture regardless of input", () => {
  const withData = classifyVariant(
    baseInput({
      clinvar: { status: "available", germlineClassification: { description: "Benign", conditions: [] } },
    }),
  );
  const withoutData = classifyVariant(baseInput());
  for (const result of [withData, withoutData]) {
    const pp5 = result.germlineSignificance.internalComputation.criteriaSuppressed.find((c) => c.code === "PP5");
    const bp6 = result.germlineSignificance.internalComputation.criteriaSuppressed.find((c) => c.code === "BP6");
    assert.equal(pp5.met, "not_assessed");
    assert.equal(bp6.met, "not_assessed");
  }
});

test("oncogenicity incompatibility matrix rejects every declared incompatible pair", () => {
  const pairs = [
    ["OM1", "OS1"],
    ["OM1", "OS3"],
    ["OM2", "OVS1"],
    ["OM3", "OM1"],
    ["OM3", "OM4"],
    ["OM4", "OS1"],
    ["OM4", "OS3"],
    ["OM4", "OM1"],
    ["OP1", "SBP1"],
    ["OS2", "SBS2"],
    ["OS3", "OM3"],
    ["OS3", "OP3"],
    ["OM3", "OP3"],
  ];
  for (const [a, b] of pairs) {
    const criteria = [
      { code: a, strength: "moderate", met: true, points: 2, rationale: "test" },
      { code: b, strength: "moderate", met: true, points: 2, rationale: "test" },
    ];
    const validation = OncogenicityCompatibilityValidator.validate(criteria);
    assert.equal(validation.valid, false, `expected ${a}+${b} to be invalid`);
    assert.ok(validation.validationErrors.some((e) => e.includes(a) && e.includes(b)));
  }
});

test("OVS1 never fires for a missense SNV; OM2 is excluded for a plain missense SNV even with a corroborated functional effect", () => {
  const result = classifyVariant(
    baseInput({
      normalizedVariant: { variantType: "SNV" },
      clinvar: { status: "available", molecularConsequence: ["missense variant"] },
      oncokb: { status: "available", mutationEffect: "Loss-of-function", mutationEffectDescription: "Some effect" },
    }),
  );
  const ovs1 = result.somaticOncogenicity.internalComputation.criteriaNotApplicable.find((c) => c.code === "OVS1");
  assert.equal(ovs1.met, "not_applicable");
  assert.match(ovs1.reason, /not to a plain missense SNV/);
  const om2 = result.somaticOncogenicity.internalComputation.criteriaNotApplicable.find((c) => c.code === "OM2");
  assert.equal(om2.met, "not_applicable");
  assert.match(om2.reason, /not to a plain missense SNV/);
});

test("OP2 (multi-tumor-type recurrence) is explicitly excluded for AML by disease-scoping policy, even with strong cBioPortal multi-tumor recurrence evidence", () => {
  const result = classifyVariant(
    baseInput({
      normalizedVariant: { disease: "Acute myeloid leukemia" },
      cbioportal: { status: "available", tumorTypes: ["AML", "Breast", "Lung"], mutationCount: 20 },
    }),
  );
  const op2 = result.somaticOncogenicity.internalComputation.criteriaNotApplicable.find((c) => c.code === "OP2");
  assert.equal(op2.met, "not_applicable");
  assert.match(op2.reason, /not applicable to AML/);
});

test("OM1 is not triggered by a generic hotspot flag and OM4 is not triggered by population rarity", () => {
  const result = classifyVariant(
    baseInput({
      normalizedVariant: { gene: "TP53", proteinChange: "p.R175H", variantType: "SNV" },
      clinvar: { status: "available", molecularConsequence: ["missense variant"] },
      oncokb: { status: "available", hotspot: true },
      gnomad: { status: "available", alleleFrequency: 0.000001, popmaxFrequency: 0.000001, qualityStatus: "available", rsIds: [] },
    }),
  );
  assert.equal(result.somaticOncogenicity.internalComputation.criteriaMet.some((c) => c.code === "OM1"), false);
  assert.equal(result.somaticOncogenicity.internalComputation.criteriaMet.some((c) => c.code === "OM4"), false);
  assert.ok(result.somaticOncogenicity.internalComputation.criteriaNotAssessed.find((c) => c.code === "OM1"));
  assert.ok(result.somaticOncogenicity.internalComputation.criteriaNotAssessed.find((c) => c.code === "OM4"));
  assert.ok(result.somaticOncogenicity.internalComputation.criteriaMet.find((c) => c.code === "OP4"));
});

test("OP4 is not assessed unless population data are successfully queried with adequate status", () => {
  const failed = classifyVariant(
    baseInput({
      gnomad: { status: "query_failed", rsIds: [] },
    }),
  );
  const failedOp4 = failed.somaticOncogenicity.internalComputation.criteriaNotAssessed.find((c) => c.code === "OP4");
  assert.equal(failedOp4.met, "not_assessed");

  const lowQuality = classifyVariant(
    baseInput({
      gnomad: { status: "available", alleleFrequency: 0.000001, popmaxFrequency: 0.000001, qualityStatus: "coverage_low", rsIds: [] },
    }),
  );
  const lowQualityOp4 = lowQuality.somaticOncogenicity.internalComputation.criteriaNotAssessed.find((c) => c.code === "OP4");
  assert.equal(lowQualityOp4.met, "not_assessed");
});

test("disease alias normalization: AML aliases converge on one normalized concept with a stable ontology id; unmapped free text is treated as its own unmapped concept", () => {
  const aml1 = normalizeDisease("AML");
  const aml2 = normalizeDisease("acute myeloid leukemia");
  const aml3 = normalizeDisease("Acute Myelogenous Leukemia");
  assert.equal(aml1.normalizedName, "Acute myeloid leukemia");
  assert.equal(aml1.ontologyId, "NCIT:C3171");
  assert.equal(aml1.normalizedName, aml2.normalizedName);
  assert.equal(aml1.normalizedName, aml3.normalizedName);

  const unmapped = normalizeDisease("Some rare disease nobody curated");
  assert.equal(unmapped.ontologyId, "");
  assert.equal(unmapped.normalizedName, "Some rare disease nobody curated");
});

test("disease matching categorizes exact/subtype/cross_tumor/ambiguous correctly and never treats 'no disease submitted' as matching everything", () => {
  assert.equal(matchDisease("Acute myeloid leukemia", "AML"), "exact");
  assert.equal(matchDisease("Myeloid neoplasm", "AML"), "subtype"); // source is a listed parent of the submitted AML concept
  assert.equal(matchDisease("Breast cancer", "Chronic lymphocytic leukemia"), "cross_tumor"); // no shared parent disease
  assert.equal(matchDisease("Breast cancer", "Colorectal cancer"), "histology_agnostic"); // both share the "Solid tumor" parent
  assert.equal(matchDisease("Breast cancer", undefined), "ambiguous");
  assert.equal(matchDisease(undefined, "AML"), "ambiguous");
});

test("specimen-role inference never assumes peripheral blood is a normal/germline comparator for hematologic disease, but treats it as role-unknown for solid-tumor disease", () => {
  assert.equal(inferSpecimenRole("Acute myeloid leukemia", "peripheral_blood"), "disease_specimen");
  assert.equal(inferSpecimenRole("Breast cancer", "peripheral_blood"), "unknown");
  assert.equal(inferSpecimenRole("Breast cancer", "bone_marrow"), "disease_specimen");
  assert.equal(inferSpecimenRole("Breast cancer", "buccal_swab"), "constitutional_germline_test");
  assert.equal(inferSpecimenRole(undefined, "unknown"), "unknown");
  assert.equal(inferSpecimenRole(undefined, undefined), "unknown");
});

test("VAF parsing accepts fractions and percentages, rejects out-of-range/invalid input, and never changes the germline or oncogenicity score", () => {
  assert.deepEqual(parseVaf("0.42"), { ok: true, fraction: 0.42 });
  assert.deepEqual(parseVaf("42%"), { ok: true, fraction: 0.42 });
  assert.deepEqual(parseVaf(0.42), { ok: true, fraction: 0.42 });
  assert.equal(parseVaf("not-a-number").ok, false);
  assert.equal(parseVaf("142%").ok, false);
  assert.equal(parseVaf(undefined).ok, false);

  const lowVaf = classifyVariant(
    baseInput({
      normalizedVariant: { vaf: 0.05 },
      gnomad: { status: "available", alleleFrequency: 0.12, popmaxFrequency: 0.12, rsIds: [] },
    }),
  );
  const highVaf = classifyVariant(
    baseInput({
      normalizedVariant: { vaf: 0.9 },
      gnomad: { status: "available", alleleFrequency: 0.12, popmaxFrequency: 0.12, rsIds: [] },
    }),
  );
  assert.equal(lowVaf.germlineSignificance.internalComputation.score, highVaf.germlineSignificance.internalComputation.score);
  assert.equal(lowVaf.somaticOncogenicity.internalComputation.score, highVaf.somaticOncogenicity.internalComputation.score);
});

test("clinical-impact axes are evaluated independently: a benign oncogenicity call yields Tier_IV on diagnostic/prognostic while therapeutic still reports applicability_not_fully_assessable", () => {
  const result = classifyVariant(
    baseInput({
      normalizedVariant: { disease: "Breast cancer" },
      gnomad: { status: "available", alleleFrequency: 0.12, popmaxFrequency: 0.12, rsIds: [] },
    }),
  );
  const diagnostic = result.somaticClinicalImpact.axes.find((a) => a.axis === "diagnostic");
  const prognostic = result.somaticClinicalImpact.axes.find((a) => a.axis === "prognostic");
  const therapeutic = result.somaticClinicalImpact.axes.find((a) => a.axis === "therapeutic");
  assert.equal(diagnostic.status, "tier_assigned");
  assert.equal(diagnostic.tier, "Tier_IV");
  assert.equal(prognostic.status, "tier_assigned");
  assert.equal(prognostic.tier, "Tier_IV");
  assert.equal(therapeutic.status, "applicability_not_fully_assessable");
});

test("clinical-impact distinguishes a genuine negative search (sources reached, no rule found -> Tier_III) from a source-failure (sources unreachable -> not_computed)", () => {
  const reachedNoRule = classifyVariant(
    baseInput({
      normalizedVariant: { gene: "BRAF", disease: "Breast cancer" },
      clinvar: { status: "not_found" },
      oncokb: { status: "not_found" },
    }),
  );
  const diagnosticReached = reachedNoRule.somaticClinicalImpact.axes.find((a) => a.axis === "diagnostic");
  assert.equal(diagnosticReached.status, "tier_assigned");
  assert.equal(diagnosticReached.tier, "Tier_III");

  const sourcesDown = classifyVariant(
    baseInput({
      normalizedVariant: { gene: "BRAF", disease: "Breast cancer" },
      clinvar: { status: "query_failed" },
      oncokb: { status: "query_failed" },
    }),
  );
  const diagnosticDown = sourcesDown.somaticClinicalImpact.axes.find((a) => a.axis === "diagnostic");
  assert.equal(diagnosticDown.status, "not_computed");
  assert.equal(diagnosticDown.reason, "required_clinical_sources_unavailable");
});

test("source failure does not promote an incomplete internal computation to a displayed VUS primary", () => {
  const result = classifyVariant(
    baseInput({
      clinvar: { status: "query_failed" },
      oncokb: { status: "permission_denied" },
      gnomad: { status: "query_failed", rsIds: [] },
      computationalPrediction: { status: "query_failed" },
    }),
  );
  assert.equal(result.germlineSignificance.primaryClassification, "Not computed");
  assert.equal(result.somaticOncogenicity.primaryClassification, "Not computed");
});

test("manual review is not flagged when the internal computation remains VUS/incomplete despite a highest-authority external assertion, since VUS is never treated as a firm disagreement", () => {
  const disagreeing = classifyVariant(
    baseInput({
      clinvar: {
        status: "available",
        germlineClassification: { description: "Benign", reviewStatus: "practice guideline", conditions: [] },
        molecularConsequence: ["in-frame deletion"],
      },
      gnomad: { status: "available", alleleFrequency: 0.0000005, popmaxFrequency: 0.0000005, rsIds: [] },
      oncokb: { status: "available", hotspot: true },
    }),
  );
  assert.ok(!disagreeing.manualReviewFlags.some((f) => f.domain === "germline"));

  const vusOnly = classifyVariant(
    baseInput({
      clinvar: {
        status: "available",
        germlineClassification: { description: "Benign", reviewStatus: "practice guideline", conditions: [] },
      },
      gnomad: { status: "available", alleleFrequency: 0.0000005, popmaxFrequency: 0.0000005, rsIds: [] },
      computationalPrediction: { status: "available", revelScore: 0.95, predictor: "REVEL" },
      oncokb: { status: "available", hotspot: true },
    }),
  );
  assert.ok(!vusOnly.manualReviewFlags.some((f) => f.domain === "germline"));
});

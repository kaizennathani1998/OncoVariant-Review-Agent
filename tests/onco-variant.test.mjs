import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isProteinMatch,
  mapReferenceGenome,
  normalizeProteinChange,
  parseOncoKbResponse,
  proteinChangeCandidates,
} from "../src/lib/onco-variant/parsers.mjs";

test("maps genome builds for OncoKB", () => {
  assert.equal(mapReferenceGenome("hg19"), "GRCh37");
  assert.equal(mapReferenceGenome("hg38"), "GRCh38");
});

test("normalizes NPM1 W288 frameshift forms as related candidates", () => {
  const candidates = proteinChangeCandidates("p.W288Cfs*12");
  assert.equal(normalizeProteinChange("W288CfsTer12"), "W288Cfs*12");
  assert.deepEqual(isProteinMatch("W288fs", candidates), { matched: true, approximate: false });
  assert.deepEqual(isProteinMatch("W288CfsTer12", candidates), { matched: true, approximate: false });
  assert.deepEqual(isProteinMatch("W290fs", candidates), { matched: false, approximate: false });
});

test("parses OncoKB treatments, levels, drugs, implications, and PMIDs", () => {
  const parsed = parseOncoKbResponse({
    oncogenic: "Oncogenic",
    mutationEffect: {
      knownEffect: "Gain-of-function",
      description: "NPM1 frameshift effect description",
    },
    highestSensitiveLevel: "LEVEL_1",
    highestFdaLevel: "LEVEL_Fda1",
    highestDiagnosticImplicationLevel: "LEVEL_Dx1",
    highestPrognosticImplicationLevel: "LEVEL_Px1",
    treatments: [
      {
        level: "LEVEL_1",
        fdaLevel: "LEVEL_Fda1",
        cancerType: "AML",
        description: "Sensitive NPM1-mutated AML treatment context",
        drugs: [{ drugName: "Revumenib" }, { drugName: "Ziftomenib" }],
        alterations: [{ alteration: "W288Cfs*12" }],
        pmids: ["12345", "67890"],
      },
    ],
    diagnosticImplications: [{ level: "LEVEL_Dx1" }],
    prognosticImplications: [{ level: "LEVEL_Px1" }],
  });

  assert.equal(parsed.oncogenicity, "Oncogenic");
  assert.equal(parsed.mutationEffect, "Gain-of-function");
  assert.equal(parsed.mutationEffectDescription, "NPM1 frameshift effect description");
  assert.equal(parsed.highestSensitiveLevel, "LEVEL_1");
  assert.equal(parsed.highestFdaLevel, "LEVEL_Fda1");
  assert.equal(parsed.highestDiagnosticImplicationLevel, "LEVEL_Dx1");
  assert.equal(parsed.highestPrognosticImplicationLevel, "LEVEL_Px1");
  assert.deepEqual(parsed.drugs, ["Revumenib", "Ziftomenib"]);
  assert.equal(parsed.therapeuticImplications.length, 1);
  assert.deepEqual(parsed.therapeuticImplications[0].pmids, ["12345", "67890"]);
  assert.equal(parsed.diagnosticImplications.length, 1);
  assert.equal(parsed.prognosticImplications.length, 1);
});

test("cBioPortal production adapter does not return mock status on failure", async () => {
  const source = await readFile(new URL("../src/lib/onco-variant/sources.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /mockCbioPortal/);
  assert.match(source, /status: "unavailable"/);
  assert.match(source, /cBioPortal could not be queried at this time/);
});

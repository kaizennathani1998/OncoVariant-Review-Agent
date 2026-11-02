export function mapReferenceGenome(build) {
  return build === "hg38" ? "GRCh38" : "GRCh37";
}

export function stripProteinPrefix(value = "") {
  return String(value).trim().replace(/^p\./i, "");
}

const THREE_TO_ONE = {
  Ala: "A",
  Arg: "R",
  Asn: "N",
  Asp: "D",
  Cys: "C",
  Gln: "Q",
  Glu: "E",
  Gly: "G",
  His: "H",
  Ile: "I",
  Leu: "L",
  Lys: "K",
  Met: "M",
  Phe: "F",
  Pro: "P",
  Ser: "S",
  Thr: "T",
  Trp: "W",
  Tyr: "Y",
  Val: "V",
  Ter: "*",
  Sec: "U",
  Pyl: "O",
};

function normalizeThreeLetterProtein(value = "") {
  return String(value).replace(
    /(Ala|Arg|Asn|Asp|Cys|Gln|Glu|Gly|His|Ile|Leu|Lys|Met|Phe|Pro|Ser|Thr|Trp|Tyr|Val|Ter|Sec|Pyl)(\d+)(Ala|Arg|Asn|Asp|Cys|Gln|Glu|Gly|His|Ile|Leu|Lys|Met|Phe|Pro|Ser|Thr|Trp|Tyr|Val|Ter|Sec|Pyl)/g,
    (_, from, pos, to) => `${THREE_TO_ONE[from] ?? from}${pos}${THREE_TO_ONE[to] ?? to}`,
  );
}

export function normalizeProteinChange(value = "") {
  return normalizeThreeLetterProtein(stripProteinPrefix(value))
    .replace(/Ter/gi, "*")
    .replace(/fs\*/i, "fs*")
    .replace(/\s+/g, "");
}

export function proteinChangeCandidates(value = "") {
  const normalized = normalizeProteinChange(value);
  const candidates = new Set([normalized]);
  const fsMatch = normalized.match(/^([A-Z*])(\d+).*fs(?:\*(\d+))?/i);
  if (fsMatch) {
    const [, aa, pos, ter] = fsMatch;
    candidates.add(`${aa}${pos}fs`);
    if (ter) {
      candidates.add(`${aa}${pos}fs*${ter}`);
      candidates.add(`${aa}${pos}fsTer${ter}`);
      candidates.add(`${aa}${pos}Cfs*${ter}`);
      candidates.add(`${aa}${pos}CfsTer${ter}`);
    }
  }
  return Array.from(candidates).filter(Boolean);
}

export function isProteinMatch(observed = "", candidates = []) {
  const normalizedObserved = normalizeProteinChange(observed);
  const normalizedCandidates = candidates.map(normalizeProteinChange);
  if (normalizedCandidates.includes(normalizedObserved)) return { matched: true, approximate: false };
  const observedFs = normalizedObserved.match(/^([A-Z*])(\d+).*fs/i);
  const candidateFs = normalizedCandidates.map((candidate) => candidate.match(/^([A-Z*])(\d+).*fs/i)).find(Boolean);
  if (observedFs && candidateFs && observedFs[1] === candidateFs[1] && observedFs[2] === candidateFs[2]) {
    return { matched: true, approximate: true };
  }
  return { matched: false, approximate: false };
}

export function parseOncoKbResponse(raw = {}) {
  const mutationEffect = isObject(raw.mutationEffect) ? raw.mutationEffect : {};
  const treatments = Array.isArray(raw.treatments) ? raw.treatments : [];
  const diagnosticImplications = Array.isArray(raw.diagnosticImplications) ? raw.diagnosticImplications : [];
  const prognosticImplications = Array.isArray(raw.prognosticImplications) ? raw.prognosticImplications : [];
  const therapeuticImplications = treatments.map((treatment) => {
    const drugs = Array.isArray(treatment?.drugs)
      ? treatment.drugs.map((drug) => drug?.drugName ?? drug?.name ?? drug).filter(Boolean).map(String)
      : [];
    const alterations = Array.isArray(treatment?.alterations)
      ? treatment.alterations.map((alteration) => alteration?.alteration ?? alteration?.name ?? alteration).filter(Boolean).map(String)
      : [];
    const pmids = collectPmids(treatment);
    return {
      drugs,
      level: stringOrUndefined(treatment?.level),
      fdaLevel: stringOrUndefined(treatment?.fdaLevel),
      cancerType: stringOrUndefined(treatment?.cancerType) ?? stringOrUndefined(treatment?.tumorType),
      alterations,
      pmids,
      description: stringOrUndefined(treatment?.description),
    };
  });
  const drugs = unique(therapeuticImplications.flatMap((item) => item.drugs));
  const citations = unique([...collectPmids(raw), ...therapeuticImplications.flatMap((item) => item.pmids)]);

  return {
    oncogenicity: stringOrUndefined(raw.oncogenicity) ?? stringOrUndefined(raw.oncogenic),
    mutationEffect: stringOrUndefined(mutationEffect.knownEffect) ?? stringOrUndefined(raw.mutationEffect),
    mutationEffectDescription: stringOrUndefined(mutationEffect.description),
    biologicalEffect: stringOrUndefined(raw.biologicalEffect),
    highestSensitiveLevel: stringOrUndefined(raw.highestSensitiveLevel),
    highestFdaLevel: stringOrUndefined(raw.highestFdaLevel),
    highestResistanceLevel: stringOrUndefined(raw.highestResistanceLevel),
    otherSignificantResistanceLevels: Array.isArray(raw.otherSignificantResistanceLevels) ? raw.otherSignificantResistanceLevels.filter(Boolean).map(String) : [],
    highestDiagnosticImplicationLevel: stringOrUndefined(raw.highestDiagnosticImplicationLevel),
    highestPrognosticImplicationLevel: stringOrUndefined(raw.highestPrognosticImplicationLevel),
    hotspot: typeof raw.hotspot === "boolean" ? raw.hotspot : undefined,
    tumorTypeSummary: stringOrUndefined(raw.tumorTypeSummary),
    prognosticSummary: stringOrUndefined(raw.prognosticSummary),
    diagnosticSummary: stringOrUndefined(raw.diagnosticSummary),
    therapeuticImplications,
    evidenceLevel: unique(therapeuticImplications.map((item) => item.level).filter(Boolean)).join(", ") || undefined,
    drugs,
    treatments,
    diagnosticImplications,
    prognosticImplications,
    citations,
  };
}

function collectPmids(value) {
  const pmids = [];
  walk(value, (node) => {
    if (!node || typeof node !== "object") return;
    for (const [key, val] of Object.entries(node)) {
      if (/pmid/i.test(key)) {
        if (Array.isArray(val)) pmids.push(...val.map(String));
        else if (val != null) pmids.push(String(val));
      }
    }
  });
  return unique(pmids.flatMap((item) => String(item).split(/[,\s;]+/)).filter((item) => /^\d+$/.test(item)));
}

function walk(value, visitor, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  visitor(value);
  if (Array.isArray(value)) value.forEach((item) => walk(item, visitor, seen));
  else Object.values(value).forEach((item) => walk(item, visitor, seen));
}

function stringOrUndefined(value) {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

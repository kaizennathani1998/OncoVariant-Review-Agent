"use client";

import type React from "react";
import { useMemo, useState } from "react";
import { AlertTriangle, Clipboard, Database, Download, ExternalLink, FileJson, FlaskConical, Loader2, Search, ShieldCheck, Sparkles } from "lucide-react";
import { buildMarkdownReport } from "@/lib/onco-variant/report";
import type { ClinVarClassification, CriterionOutcome, GenomeBuild, SourceStatus, SpecimenMaterial, VariantReviewRequest, VariantReviewResponse } from "@/lib/onco-variant/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const EXAMPLE: VariantReviewRequest = {
  chrom: "chr17",
  pos: 7578406,
  ref: "C",
  alt: "T",
  build: "hg19",
  gene: "TP53",
  proteinChange: "p.R175H",
  cancerType: "AML",
  disease: "Acute myeloid leukemia",
  specimenMaterial: "bone_marrow",
  vaf: "0.42",
};

type FormState = Omit<VariantReviewRequest, "pos" | "vaf"> & { pos: string; vaf: string };
const INITIAL_FORM: FormState = { ...EXAMPLE, pos: String(EXAMPLE.pos), vaf: String(EXAMPLE.vaf ?? "") };
const NPM1_EXAMPLE: FormState = {
  chrom: "chr5",
  pos: "170837547",
  ref: "G",
  alt: "GCCTG",
  build: "hg19",
  gene: "NPM1",
  proteinChange: "p.W288Cfs*12",
  cancerType: "AML",
  disease: "Acute myeloid leukemia",
  specimenMaterial: "bone_marrow",
  vaf: "0.35",
};

export function OncoVariantDashboard() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [result, setResult] = useState<VariantReviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const requestBody = useMemo<VariantReviewRequest>(() => ({ ...form, pos: Number(form.pos), vaf: form.vaf?.trim() ? form.vaf : undefined }), [form]);

  async function submitReview() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/review-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Variant review failed.");
      setResult(payload as VariantReviewResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Variant review failed.");
    } finally {
      setIsLoading(false);
    }
  }

  async function copyJson() {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied("json");
  }

  async function copyText(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
  }

  function exportMarkdown() {
    if (!result) return;
    const blob = new Blob([buildMarkdownReport(result)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result.normalizedVariant.gene ?? "variant"}-${result.normalizedVariant.pos}-review.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    setCopied("markdown");
  }

  function openJsonWindow() {
    if (!result) return;
    const win = window.open("", "_blank", "noopener,noreferrer,width=1100,height=800");
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>OncoLens AI JSON Review Payload</title>
          <style>
            body { margin: 0; background: #071014; color: #d9e7ee; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
            header { position: sticky; top: 0; padding: 16px 20px; background: #0b171d; border-bottom: 1px solid #20323b; font-family: Inter, system-ui, sans-serif; }
            pre { margin: 0; padding: 20px; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.55; }
          </style>
        </head>
        <body>
          <header><strong>OncoLens AI</strong><br/><span>Normalized request and source response JSON</span></header>
          <pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>
        </body>
      </html>
    `);
    win.document.close();
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-background">
      <div className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/10"><FlaskConical /></div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">OncoLens AI</h1>
                <p className="text-sm text-muted-foreground">ClinVar, OncoKB, cBioPortal, and AI-assisted variant review</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={result?.clinvar.status} label="ClinVar" />
              <StatusBadge status={result?.oncokb.status} label="OncoKB" />
              <StatusBadge status={result?.cbioportal.status} label="cBioPortal" />
            </div>
          </div>
          <Card className="rounded-lg border-border/80 bg-card shadow-sm">
            <CardHeader>
              <CardTitle>Case variant input</CardTitle>
              <CardDescription>Enter variant coordinates and disease context for source-specific evidence review.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex justify-start sm:justify-end">
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setForm(NPM1_EXAMPLE)}><Sparkles data-icon="inline-start" />NPM1 AML</Button>
                  <Button variant="outline" onClick={() => setForm(INITIAL_FORM)}><Sparkles data-icon="inline-start" />TP53 R175H</Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-8">
                <Field label="Chromosome"><Input value={form.chrom} onChange={(e) => update("chrom", e.target.value)} /></Field>
                <Field label="Position"><Input value={form.pos} onChange={(e) => update("pos", e.target.value)} inputMode="numeric" /></Field>
                <Field label="Ref"><Input value={form.ref} onChange={(e) => update("ref", e.target.value)} /></Field>
                <Field label="Alt"><Input value={form.alt} onChange={(e) => update("alt", e.target.value)} /></Field>
                <Field label="Build">
                  <select className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" value={form.build} onChange={(e) => update("build", e.target.value as GenomeBuild)}>
                    <option value="hg19">hg19</option>
                    <option value="hg38">hg38</option>
                  </select>
                </Field>
                <Field label="Gene"><Input value={form.gene ?? ""} onChange={(e) => update("gene", e.target.value)} /></Field>
                <Field label="Protein"><Input value={form.proteinChange ?? ""} onChange={(e) => update("proteinChange", e.target.value)} /></Field>
                <Field label="Tumor code"><Input value={form.cancerType ?? ""} onChange={(e) => update("cancerType", e.target.value)} placeholder="e.g. AML" /></Field>
                <Field label="Diagnosis"><Input value={form.disease ?? ""} onChange={(e) => update("disease", e.target.value)} placeholder="e.g. Acute myeloid leukemia" /></Field>
                <Field label="Specimen">
                  <select className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" value={form.specimenMaterial ?? "unknown"} onChange={(e) => update("specimenMaterial", e.target.value as SpecimenMaterial)}>
                    <option value="unknown">Unknown</option>
                    <option value="bone_marrow">Bone marrow</option>
                    <option value="peripheral_blood">Peripheral blood</option>
                    <option value="solid_tumor_tissue">Solid tumor tissue</option>
                    <option value="constitutional_tissue">Constitutional tissue</option>
                    <option value="buccal_swab">Buccal swab</option>
                    <option value="saliva">Saliva</option>
                    <option value="cultured_fibroblasts">Cultured fibroblasts</option>
                  </select>
                </Field>
                <Field label="VAF"><Input value={form.vaf ?? ""} onChange={(e) => update("vaf", e.target.value)} placeholder="e.g. 0.42 or 42%" /></Field>
              </div>
              <div className="mt-4 flex flex-col justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
                <p className="text-xs text-muted-foreground">API keys stay server-side in <code>.env.local</code>. Mock fields are explicitly labeled.</p>
                <Button onClick={submitReview} disabled={isLoading}>{isLoading ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Search data-icon="inline-start" />}Review variant</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertTriangle className="mr-2 inline-block" />{error}</div> : null}
        {result ? <NormalizedReview result={result} /> : null}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="(A) Germline (ACMG/AMP)" value={result?.classification.germlineSignificance.primaryClassification ?? "Awaiting review"} detail={result ? `Basis: ${result.classification.germlineSignificance.classificationBasis}` : "Independent output"} icon={ShieldCheck} />
          <SummaryCard title="(B) Somatic oncogenicity (CGC-VICC)" value={result?.classification.somaticOncogenicity.primaryClassification ?? "Awaiting review"} detail={result ? `Basis: ${result.classification.somaticOncogenicity.classificationBasis}` : "Independent output"} icon={FlaskConical} />
          <SummaryCard title="(C) Somatic clinical impact" value={result ? result.classification.somaticClinicalImpact.axes.map((a) => a.tier ?? a.status).join(" / ") : "Awaiting review"} detail="Therapeutic / diagnostic / prognostic (each independent)" icon={Sparkles} />
          <SummaryCard title="(D) Origin assessment" value={result?.classification.originAssessment.conclusion ?? "Awaiting review"} detail={result ? `Specimen role: ${result.classification.originAssessment.specimenRole}` : "Independent output"} icon={Database} />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard title="ClinVar" value={summarizeClinVarTracks(result?.clinvar)} detail="Germline / somatic clinical impact / oncogenicity" icon={ShieldCheck} status={result?.clinvar.status} />
          <SummaryCard title="OncoKB" value={result?.oncokb.oncogenicity ?? "Token-dependent"} detail={result?.oncokb.drugs.length ? result.oncokb.drugs.join(", ") : result?.oncokb.mutationEffect ?? "Oncogenicity and effect"} icon={Sparkles} status={result?.oncokb.status} />
          <SummaryCard title="cBioPortal" value={result ? `${result.cbioportal.mutationCount ?? 0} mutations` : "No result yet"} detail={result?.cbioportal.caveat ?? "Study matching"} icon={Database} status={result?.cbioportal.status} />
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="rounded-lg border-border/80">
            <CardHeader><CardTitle>Evidence workspace</CardTitle><CardDescription>Source records, source caveats, and summary text generated only from retrieved data.</CardDescription></CardHeader>
            <CardContent>{isLoading ? <LoadingState /> : result ? <EvidenceTabs result={result} /> : <EmptyState />}</CardContent>
          </Card>
          <div className="flex flex-col gap-5">
            <Card className="rounded-lg border-border/80">
              <CardHeader><CardTitle>Review links</CardTitle><CardDescription>Genome-browser context and coordinate conversion for source review.</CardDescription></CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="rounded-lg border border-border bg-muted/35 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">UCSC Genome Browser</p>
                  {result ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <a className="flex items-center gap-2 text-sm text-primary hover:underline" href={result.ucscUrls.hg19} target="_blank" rel="noreferrer">Open hg19 with ClinVar tracks<ExternalLink /></a>
                      <a className="flex items-center gap-2 text-sm text-primary hover:underline" href={result.ucscUrls.hg38} target="_blank" rel="noreferrer">Open hg38 with ClinVar tracks<ExternalLink /></a>
                    </div>
                  ) : <p className="mt-2 text-sm text-muted-foreground">Generated after review.</p>}
                </div>
                <div className="rounded-lg border border-border bg-muted/35 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Liftover</p>
                  {result ? (
                    <div className="mt-2 flex flex-col gap-3 text-sm">
                      <p className="text-muted-foreground">{result.normalizedVariant.liftover.message}</p>
                      <CoordinateCopyRow label="hg19" value={formatCoordinate(result.normalizedVariant.hg19)} copied={copied === "hg19-coordinate"} onCopy={() => copyText(formatCoordinate(result.normalizedVariant.hg19), "hg19-coordinate")} />
                      <CoordinateCopyRow label="hg38" value={formatCoordinate(result.normalizedVariant.hg38)} copied={copied === "hg38-coordinate"} onCopy={() => copyText(formatCoordinate(result.normalizedVariant.hg38), "hg38-coordinate")} />
                    </div>
                  ) : <p className="mt-2 text-sm text-muted-foreground">Shown after review.</p>}
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-lg border-border/80">
              <CardHeader><CardTitle>Export panel</CardTitle><CardDescription>Optional payload and report actions.</CardDescription></CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <Button className="flex-1" variant="outline" disabled={!result} onClick={copyJson}><Clipboard data-icon="inline-start" />{copied === "json" ? "Copied" : "Copy JSON"}</Button>
                  <Button className="flex-1" variant="outline" disabled={!result} onClick={exportMarkdown}><Download data-icon="inline-start" />{copied === "markdown" ? "Exported" : "Markdown"}</Button>
                </div>
                <Button variant="outline" disabled={!result} onClick={openJsonWindow}><FileJson data-icon="inline-start" />Open JSON payload</Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
}

function NormalizedReview({ result }: { result: VariantReviewResponse }) {
  const v = result.normalizedVariant;
  const [copied, setCopied] = useState<string | null>(null);
  async function copyText(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Card className="rounded-lg border-border/80">
        <CardHeader>
          <CardTitle>Normalized variant</CardTitle>
          <CardDescription>Processed representation used for source queries. This is not source evidence.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MiniFact label="Genomic HGVS" value={v.genomicHgvs} />
            <MiniFact label="Gene" value={v.gene ?? "Not provided"} />
            <MiniFact label="Build supplied" value={v.build} />
            <MiniFact label="Tumor code" value={v.cancerType ?? "Not provided"} />
          </div>
          <CoordinateCopyRow
            label="RefSeq transcript"
            value={v.refSeqTranscript ?? "Not resolved"}
            copied={copied === "refseq-transcript"}
            onCopy={() => copyText(v.refSeqTranscript ?? "", "refseq-transcript")}
          />
        </CardContent>
      </Card>
      <Card className="rounded-lg border-border/80">
        <CardHeader>
          <CardTitle>Normalized protein</CardTitle>
          <CardDescription>Protein-change aliases used for exact and related matching.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <MiniFact label="Submitted protein" value={v.proteinChange ?? "Not provided"} />
          <MiniFact label="Canonical protein" value={v.normalizedProteinChange ?? "Not provided"} />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Candidate aliases</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {v.proteinChangeCandidates.length ? v.proteinChangeCandidates.map((candidate) => <Badge key={candidate} variant="secondary">{candidate}</Badge>) : <span className="text-sm text-muted-foreground">None generated</span>}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ClassificationCard({ title, classification }: { title: string; classification?: ClinVarClassification }) {
  const isConflicting = classification?.reviewStatus ? /conflicting/i.test(classification.reviewStatus) : false;
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {classification?.description ? (
        <>
          <p className="mt-1 text-sm font-semibold">{classification.description}</p>
          <p className="mt-1 text-xs text-muted-foreground">{classification.reviewStatus ?? "Review status not provided"}{classification.lastEvaluated ? ` · Evaluated ${classification.lastEvaluated}` : ""}</p>
          {isConflicting ? <Badge className="mt-2" variant="destructive">Conflicting interpretations reported</Badge> : null}
          {classification.conditions.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">{classification.conditions.map((condition) => <Badge key={condition} variant="secondary">{condition}</Badge>)}</div>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">No {title.toLowerCase()} submitted</p>
      )}
    </div>
  );
}

function summarizeClinVarTracks(clinvar?: VariantReviewResponse["clinvar"]) {
  if (!clinvar) return "No result yet";
  const populated = [clinvar.germlineClassification, clinvar.somaticClinicalImpact, clinvar.oncogenicityClassification]
    .filter((track) => track?.description)
    .map((track) => track!.description);
  return populated.length ? populated.join(" / ") : "No classification submitted";
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-muted/30 p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium">{value}</p></div>;
}

function CoordinateCopyRow({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 px-3 py-2">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="font-mono text-sm">{value}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onCopy} disabled={value === "unavailable" || value === "Not resolved"}>
        <Clipboard data-icon="inline-start" />
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5"><Label>{label}</Label>{children}</div>;
}

function SummaryCard({ title, value, detail, icon: Icon, status }: { title: string; value: string; detail: string; icon: typeof FileJson; status?: SourceStatus }) {
  return (
    <Card className="h-full rounded-lg border-border/80">
      <CardContent className="flex gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"><Icon /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>{status ? <StatusBadge status={status} /> : null}</div>
          <p className="mt-2 truncate text-base font-semibold">{value}</p>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EvidenceTabs({ result }: { result: VariantReviewResponse }) {
  return (
    <Tabs defaultValue="classification">
      <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-lg">
        <TabsTrigger value="classification" className="px-3 py-2">Classification</TabsTrigger>
        <TabsTrigger value="clinvar" className="px-3 py-2">ClinVar</TabsTrigger>
        <TabsTrigger value="oncokb" className="px-3 py-2">OncoKB</TabsTrigger>
        <TabsTrigger value="cbioportal" className="px-3 py-2">cBioPortal</TabsTrigger>
        <TabsTrigger value="genie" className="px-3 py-2">GENIE</TabsTrigger>
        <TabsTrigger value="gnomad" className="px-3 py-2">gnomAD</TabsTrigger>
        <TabsTrigger value="civic" className="px-3 py-2">CIViC</TabsTrigger>
        <TabsTrigger value="cosmic" className="px-3 py-2">COSMIC</TabsTrigger>
        <TabsTrigger value="imports" className="px-3 py-2">Import Package</TabsTrigger>
        <TabsTrigger value="guide" className="px-3 py-2">Criteria Guide</TabsTrigger>
        <TabsTrigger value="computational" className="px-3 py-2">REVEL / AlphaMissense</TabsTrigger>
        <TabsTrigger value="summary" className="px-3 py-2">AI Summary</TabsTrigger>
      </TabsList>
      <TabsContent value="classification">
        <SourceSectionTitle title="Four independent classification outputs" description="Computed deterministically from the source data in the other tabs. These four outputs are never merged into a single combined verdict phrase. The AI summary narrates each verbatim; it does not decide any of them." />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <VerdictCard
            title="(A) Germline pathogenicity (ACMG/AMP 2015)"
            verdict={result.classification.germlineSignificance.primaryClassification}
            detail={`Basis: ${result.classification.germlineSignificance.classificationBasis} · Internal status: ${result.classification.germlineSignificance.internalComputation.status}`}
          />
          <VerdictCard
            title="(B) Somatic oncogenicity (ClinGen-CGC-VICC / AMP-ASCO-CAP)"
            verdict={result.classification.somaticOncogenicity.primaryClassification}
            detail={
              result.classification.somaticOncogenicity.internalComputation.status === "invalid"
                ? `Internal computation rejected as invalid: ${result.classification.somaticOncogenicity.internalComputation.validationErrors.join("; ")}`
                : `Basis: ${result.classification.somaticOncogenicity.classificationBasis} · Score: ${result.classification.somaticOncogenicity.internalComputation.score ?? "n/a"}`
            }
          />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">(C) Somatic clinical impact</p>
            <div className="mt-2 flex flex-col gap-1">
              {result.classification.somaticClinicalImpact.axes.map((axis) => (
                <p key={axis.axis} className="text-sm"><span className="font-medium">{axis.axis}:</span> {axis.status}{axis.tier ? ` (${axis.tier})` : ""}</p>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">(D) Origin assessment</p>
            <p className="mt-2 text-sm font-semibold">{result.classification.originAssessment.conclusion}</p>
            <p className="mt-1 text-xs text-muted-foreground">Specimen role: {result.classification.originAssessment.specimenRole} · Germline not excluded: {String(result.classification.originAssessment.germlineNotExcluded)}</p>
          </div>
        </div>
        {result.classification.manualReviewFlags.length ? (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-destructive">Manual review flags</p>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-destructive">
              {result.classification.manualReviewFlags.map((flag, i) => <li key={i}>[{flag.domain}] {flag.reason}</li>)}
            </ul>
          </div>
        ) : null}
        <Separator className="my-4" />
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">(A) Germline criteria — external assertions</p>
        <ExternalAssertionList assertions={result.classification.germlineSignificance.externalAssertions} />
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">(A) Germline criteria — internal ACMG/AMP computation</p>
        <CriterionTable criteria={[...result.classification.germlineSignificance.internalComputation.criteriaMet, ...result.classification.germlineSignificance.internalComputation.criteriaNotMet, ...result.classification.germlineSignificance.internalComputation.criteriaNotAssessed, ...result.classification.germlineSignificance.internalComputation.criteriaNotApplicable]} />
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">(B) Oncogenicity criteria — external assertions</p>
        <ExternalAssertionList assertions={result.classification.somaticOncogenicity.externalAssertions} />
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">(B) Oncogenicity criteria — internal CGC-VICC computation</p>
        <CriterionTable criteria={[...result.classification.somaticOncogenicity.internalComputation.criteriaMet, ...result.classification.somaticOncogenicity.internalComputation.criteriaNotMet, ...result.classification.somaticOncogenicity.internalComputation.criteriaNotAssessed, ...result.classification.somaticOncogenicity.internalComputation.criteriaNotApplicable]} />
      </TabsContent>
      <TabsContent value="clinvar">
        <SourceSectionTitle title="ClinVar returned result" description="ClinVar reports germline, somatic clinical impact, and oncogenicity as independent classification tracks. Verify the linked source page before clinical use." />
        <SourceLinkList links={result.clinvar.reviewLinks ?? []} />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <ClassificationCard title="Germline classification" classification={result.clinvar.germlineClassification} />
          <ClassificationCard title="Somatic clinical impact" classification={result.clinvar.somaticClinicalImpact} />
          <ClassificationCard title="Oncogenicity classification" classification={result.clinvar.oncogenicityClassification} />
        </div>
        <KeyValueGrid rows={[
          ["Variant type", result.clinvar.variantType],
          ["cDNA change", result.clinvar.cdnaChange],
          ["Molecular consequence", result.clinvar.molecularConsequence.join("; ")],
          ["Protein change (all transcripts)", result.clinvar.proteinChangeAcrossTranscripts],
          ["Submission count", result.clinvar.submissionCount !== undefined ? String(result.clinvar.submissionCount) : undefined],
          ["Population frequency (ACMG PM2/BA1/BS1)", result.clinvar.populationFrequencies.map((freq) => `${freq.source}: ${freq.value}`).join("; ")],
          ["Cross-references (ACMG PP5/BP6)", result.clinvar.crossReferences.map((ref) => `${ref.db}: ${ref.id}`).join("; ")],
          ["Gene", result.clinvar.gene],
          ["HGVS names", result.clinvar.hgvsNames.join("; ")],
          ["Source", result.clinvar.sourceLink],
          ["Caveat", result.clinvar.caveat],
        ]} />
      </TabsContent>
      <TabsContent value="oncokb">
        <SourceSectionTitle title="OncoKB returned result" description="OncoKB oncogenicity, effect, and therapy assertions are tumor-type and access-level dependent." />
        <SourceLinkList links={result.oncokb.reviewLinks ?? []} />
        {result.oncokb.hotspot ? <Badge className="mt-3" variant="default">Recurrent hotspot (AMP/ASCO/CAP evidence)</Badge> : null}
        <KeyValueGrid rows={[
          ["Oncogenicity", result.oncokb.oncogenicity],
          ["Mutation effect", result.oncokb.mutationEffect],
          ["Mutation effect description", result.oncokb.mutationEffectDescription],
          ["Highest sensitive level", result.oncokb.highestSensitiveLevel],
          ["Highest resistance level", result.oncokb.highestResistanceLevel],
          ["Other resistance levels", result.oncokb.otherSignificantResistanceLevels.join(", ")],
          ["Highest FDA level", result.oncokb.highestFdaLevel],
          ["Diagnostic level", result.oncokb.highestDiagnosticImplicationLevel],
          ["Prognostic level", result.oncokb.highestPrognosticImplicationLevel],
          ["Tumor type summary", result.oncokb.tumorTypeSummary],
          ["Prognostic summary", result.oncokb.prognosticSummary],
          ["Diagnostic summary", result.oncokb.diagnosticSummary],
          ["Drugs", result.oncokb.drugs.join(", ")],
          ["PMIDs", result.oncokb.citations.join(", ")],
          ["Source", result.oncokb.sourceLink],
          ["Caveat", result.oncokb.caveat],
        ]} />
        <TreatmentTable treatments={result.oncokb.therapeuticImplications} />
        <ImplicationTable title="Prognostic implications" implications={result.oncokb.prognosticImplications} />
        <ImplicationTable title="Diagnostic implications" implications={result.oncokb.diagnosticImplications} />
      </TabsContent>
      <TabsContent value="cbioportal">
        <SourceSectionTitle title="cBioPortal returned result" description="Real cBioPortal REST results filtered locally against the normalized protein/genomic target." />
        <SourceLinkList links={result.cbioportal.reviewLinks ?? []} />
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Study</th><th className="p-3">Tumor type</th><th className="p-3">Samples</th><th className="p-3">Mutations</th><th className="p-3">Frequency</th><th className="p-3">Protein changes</th><th className="p-3">VAF / status</th></tr></thead>
            <tbody>{result.cbioportal.matchingStudies.map((study) => <tr key={study.studyId} className="border-t border-border"><td className="p-3 font-medium">{study.link ? <a className="text-primary hover:underline" href={study.link} target="_blank" rel="noreferrer">{study.name}</a> : study.name}<span className="block text-xs text-muted-foreground">{study.studyId}</span></td><td className="p-3">{study.cancerType ?? "Not listed"}</td><td className="p-3">{study.sampleCount ?? "Not listed"}</td><td className="p-3">{study.mutationCount ?? 0}</td><td className="p-3">{study.mutationFrequency ?? "Not listed"}</td><td className="p-3">{study.matchingProteinChanges?.join(", ") || "Not listed"}{study.approximateMatches ? <Badge className="mt-1" variant="secondary">approximate</Badge> : null}</td><td className="p-3">{study.sampleLevelEvidence?.length ? study.sampleLevelEvidence.map((sample) => <span className="block text-xs" key={sample.sampleId}>{sample.mutationStatus ?? "Status not listed"}{sample.vaf !== undefined ? ` · VAF ${(sample.vaf * 100).toFixed(0)}%` : ""}</span>) : "Not listed"}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{result.cbioportal.caveat}</p>
        <Separator className="my-4" />
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Queried studies</p>
        <div className="mt-2 grid gap-2">
          {result.cbioportal.queriedStudies.map((study) => <div className="rounded-lg border border-border bg-muted/25 p-3 text-xs" key={`${study.studyId}-${study.molecularProfileId ?? "none"}`}><span className="font-medium">{study.studyId}</span> · {study.status}{study.message ? <span className="text-muted-foreground"> · {study.message}</span> : null}</div>)}
        </div>
      </TabsContent>
      <TabsContent value="gnomad">
        <SourceSectionTitle title="gnomAD returned result" description="Population allele frequency can feed ACMG/AMP PM2/BA1/BS1 and CGC/VICC OP4/SBVS1/SBS1 only after successful query and adequacy review." />
        <SourceLinkList links={result.gnomad.reviewLinks ?? []} />
        <KeyValueGrid rows={[
          ["Database", result.gnomad.database],
          ["Dataset", result.gnomad.dataset],
          ["Release", result.gnomad.release],
          ["Allele frequency", result.gnomad.alleleFrequency !== undefined ? String(result.gnomad.alleleFrequency) : undefined],
          ["Allele count", result.gnomad.alleleCount !== undefined ? String(result.gnomad.alleleCount) : undefined],
          ["Allele number", result.gnomad.alleleNumber !== undefined ? String(result.gnomad.alleleNumber) : undefined],
          ["Homozygote count", result.gnomad.homozygoteCount !== undefined ? String(result.gnomad.homozygoteCount) : undefined],
          ["Population max frequency", result.gnomad.popmaxFrequency !== undefined ? String(result.gnomad.popmaxFrequency) : undefined],
          ["Population max population", result.gnomad.popmaxPopulation],
          ["rsIDs", result.gnomad.rsIds.join(", ")],
          ["Source", result.gnomad.sourceLink],
          ["Caveat", result.gnomad.caveat],
        ]} />
        <PopulationTable populations={result.gnomad.populations ?? []} />
      </TabsContent>
      <TabsContent value="genie">
        <SourceSectionTitle title="AACR GENIE public cBioPortal import" description="GENIE is queried through public cBioPortal study endpoints when available. A source failure is not treated as no recurrence evidence." />
        <SourceLinkList links={result.aacrGenie.reviewLinks ?? []} />
        <CbioStudyTable result={result.aacrGenie} />
      </TabsContent>
      <TabsContent value="civic">
        <SourceSectionTitle title="CIViC returned result" description="CIViC molecular profiles are imported as external evidence candidates and never converted directly into formal criteria without deterministic validation." />
        <SourceLinkList links={result.civic.reviewLinks ?? []} />
        <div className="mt-4 grid gap-3">
          {result.civic.molecularProfiles.length ? result.civic.molecularProfiles.map((profile) => (
            <div key={profile.id ?? profile.name} className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{profile.link ? <a className="text-primary hover:underline" href={profile.link} target="_blank" rel="noreferrer">{profile.name}</a> : profile.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">Evidence items: {profile.evidenceItemCount ?? "not returned"} · Assertions: {profile.assertionCount ?? "not returned"}</p>
            </div>
          )) : <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">{result.civic.caveat ?? "No CIViC profiles returned."}</p>}
        </div>
      </TabsContent>
      <TabsContent value="cosmic">
        <SourceSectionTitle title="COSMIC import slot" description="COSMIC mutation-level imports generally require licensed access. The app renders a review link and keeps a structured slot, but does not count COSMIC as queried evidence without configured access." />
        <SourceLinkList links={result.cosmic.reviewLinks ?? []} />
        <p className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">{result.cosmic.caveat}</p>
      </TabsContent>
      <TabsContent value="imports">
        <SourceSectionTitle title="Practical import package" description="A checklist of the minimum practical data categories needed for a more complete review. User-input-only categories stay labeled as required rather than silently inferred." />
        <ImportPackageGrid pkg={result.practicalImportPackage} />
      </TabsContent>
      <TabsContent value="guide">
        <CriteriaGuide />
      </TabsContent>
      <TabsContent value="computational">
        <SourceSectionTitle title="Computational prediction returned result" description="REVEL/AlphaMissense scores feed ACMG/AMP PP3 (supporting pathogenic) and BP4 (supporting benign)." />
        <SourceLinkList links={result.computationalPrediction.reviewLinks ?? []} />
        <KeyValueGrid rows={[
          ["Predictor", result.computationalPrediction.predictor],
          ["REVEL score", result.computationalPrediction.revelScore !== undefined ? String(result.computationalPrediction.revelScore) : undefined],
          ["AlphaMissense score", result.computationalPrediction.alphaMissenseScore !== undefined ? String(result.computationalPrediction.alphaMissenseScore) : undefined],
          ["AlphaMissense prediction", result.computationalPrediction.alphaMissensePrediction],
          ["Source", result.computationalPrediction.sourceLink],
          ["Caveat", result.computationalPrediction.caveat],
        ]} />
      </TabsContent>
      <TabsContent value="summary"><div className="mt-4 whitespace-pre-wrap rounded-lg border border-border bg-muted/35 p-4 text-sm leading-6">{result.aiSummary}</div></TabsContent>
    </Tabs>
  );
}

function VerdictCard({ title, verdict, detail }: { title: string; verdict: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-1 text-lg font-semibold">{verdict}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function CbioStudyTable({ result }: { result: VariantReviewResponse["cbioportal"] | VariantReviewResponse["aacrGenie"] }) {
  return (
    <>
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Study</th><th className="p-3">Tumor type</th><th className="p-3">Samples</th><th className="p-3">Mutations</th><th className="p-3">Frequency</th><th className="p-3">Protein changes</th><th className="p-3">VAF / status</th></tr></thead>
          <tbody>{result.matchingStudies.map((study) => <tr key={study.studyId} className="border-t border-border"><td className="p-3 font-medium">{study.link ? <a className="text-primary hover:underline" href={study.link} target="_blank" rel="noreferrer">{study.name}</a> : study.name}<span className="block text-xs text-muted-foreground">{study.studyId}</span></td><td className="p-3">{study.cancerType ?? "Not listed"}</td><td className="p-3">{study.sampleCount ?? "Not listed"}</td><td className="p-3">{study.mutationCount ?? 0}</td><td className="p-3">{study.mutationFrequency ?? "Not listed"}</td><td className="p-3">{study.matchingProteinChanges?.join(", ") || "Not listed"}{study.approximateMatches ? <Badge className="mt-1" variant="secondary">approximate</Badge> : null}</td><td className="p-3">{study.sampleLevelEvidence?.length ? study.sampleLevelEvidence.map((sample) => <span className="block text-xs" key={sample.sampleId}>{sample.mutationStatus ?? "Status not listed"}{sample.vaf !== undefined ? ` · VAF ${(sample.vaf * 100).toFixed(0)}%` : ""}</span>) : "Not listed"}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{result.caveat}</p>
      <Separator className="my-4" />
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Queried studies</p>
      <div className="mt-2 grid gap-2">
        {result.queriedStudies.length ? result.queriedStudies.map((study) => <div className="rounded-lg border border-border bg-muted/25 p-3 text-xs" key={`${study.studyId}-${study.molecularProfileId ?? "none"}`}><span className="font-medium">{study.studyId}</span> · {study.status}{study.message ? <span className="text-muted-foreground"> · {study.message}</span> : null}</div>) : <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">No studies were queried.</p>}
      </div>
    </>
  );
}

function PopulationTable({ populations }: { populations: NonNullable<VariantReviewResponse["gnomad"]["populations"]> }) {
  if (!populations.length) return null;
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Population</th><th className="p-3">AC</th><th className="p-3">AN</th><th className="p-3">AF</th></tr></thead>
        <tbody>{populations.map((population) => <tr key={population.population} className="border-t border-border"><td className="p-3 font-medium">{population.population}</td><td className="p-3">{population.alleleCount ?? "Not returned"}</td><td className="p-3">{population.alleleNumber ?? "Not returned"}</td><td className="p-3">{population.alleleFrequency ?? "Not returned"}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function ImportPackageGrid({ pkg }: { pkg: VariantReviewResponse["practicalImportPackage"] }) {
  const rows = Object.entries(pkg).filter(([key]) => key !== "caveats") as Array<[string, string]>;
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      {rows.map(([key, value]) => <MiniFact key={key} label={key.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`)} value={value} />)}
      {pkg.caveats.length ? <div className="rounded-lg border border-border bg-muted/30 p-3 md:col-span-2"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Caveats</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{pkg.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul></div> : null}
    </div>
  );
}

const GERMLINE_CRITERIA_GUIDE = [
  ["PVS1", "Null variant in a gene where loss of function is an established disease mechanism."],
  ["PS1", "Same amino-acid change as an established pathogenic variant, using independent non-circular evidence."],
  ["PS2/PM6", "De novo evidence, confirmed or assumed, requiring parent/sample context."],
  ["PS3/BS3", "Well-established functional studies supporting damaging or benign effect."],
  ["PS4", "Case-control or enrichment evidence."],
  ["PM1", "Critical domain/residue evidence from germline disease context."],
  ["PM2", "Absent/rare in population data; default Supporting in current general guidance."],
  ["PM3", "Detected in trans with pathogenic variant for recessive disease."],
  ["PM4", "Protein-length-changing in-frame indel or stop-loss, not plain missense."],
  ["PM5", "Different pathogenic missense at same residue, non-circular."],
  ["PP1/BS4", "Segregation or lack of segregation."],
  ["PP2/BP1", "Gene-level missense/LoF disease-mechanism context."],
  ["PP3/BP4", "Computational evidence, counted once and calibrated."],
  ["PP4", "Highly specific phenotype/family history."],
  ["PP5/BP6", "Reputable-source criteria; disabled by default here."],
  ["BA1/BS1", "Population frequency too high; BS1 requires disease-specific threshold."],
  ["BS2", "Observed in healthy adult for disease context."],
  ["BP2/BP5", "Phase/alternate-cause evidence."],
  ["BP3/BP7", "In-frame repetitive-region or synonymous/no-splice contexts."],
];

const SOMATIC_CRITERIA_GUIDE = [
  ["OVS1", "Qualifying loss-of-function variant in bona fide tumor suppressor gene."],
  ["OS1", "Same amino-acid change independently established as oncogenic."],
  ["OS2/SBS2", "Robust functional evidence for oncogenic or benign effect."],
  ["OS3/OM3/OP3", "Tumor-count hotspot/substitution evidence at defined thresholds."],
  ["OM1", "Critical and well-established functional domain, not generic hotspot boolean."],
  ["OM2", "Qualifying in-frame protein-length change or stop-loss."],
  ["OM4", "Different oncogenic missense at same residue; not population rarity."],
  ["OP1/SBP1", "Computational support for oncogenic or benign effect."],
  ["OP2", "Single/near-single genetic etiology malignancy applicability."],
  ["OP4", "Absent/rare in population data after successful adequate query."],
  ["SBVS1/SBS1", "Population frequency too high for somatic driver."],
  ["SBP2", "Synonymous variant with no predicted splice impact."],
];

function CriteriaGuide() {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <CriteriaGuideTable title="ACMG/AMP Germline Criteria" rows={GERMLINE_CRITERIA_GUIDE} />
      <CriteriaGuideTable title="ClinGen/CGC/VICC Somatic Oncogenicity Criteria" rows={SOMATIC_CRITERIA_GUIDE} />
      <div className="rounded-lg border border-border bg-muted/30 p-3 lg:col-span-2">
        <p className="font-medium">AMP/ASCO/CAP clinical-impact tiering</p>
        <p className="mt-2 text-sm text-muted-foreground">Therapeutic, diagnostic, and prognostic significance are separate axes. Level A/B evidence maps to Tier I, Level C/D to Tier II, unknown clinical significance to Tier III, and benign/likely benign clinical interpretation to Tier IV. Oncogenicity is not automatically an AMP tier.</p>
      </div>
    </div>
  );
}

function CriteriaGuideTable({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="bg-muted/60 p-3 font-medium">{title}</div>
      <table className="w-full text-left text-sm">
        <tbody>{rows.map(([code, description]) => <tr key={code} className="border-t border-border"><td className="w-28 p-3 font-mono font-medium">{code}</td><td className="p-3 text-muted-foreground">{description}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function CriterionTable({ criteria }: { criteria: CriterionOutcome[] }) {
  const notAssessedCount = criteria.filter((c) => c.met === "not_assessed").length;
  const notApplicableCount = criteria.filter((c) => c.met === "not_applicable").length;
  return (
    <div className="mt-2">
      <p className="text-xs text-muted-foreground">{notAssessedCount} of {criteria.length} criteria could not be assessed from available data; {notApplicableCount} not applicable to this variant/context.</p>
      <div className="mt-2 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Code</th><th className="p-3">Strength</th><th className="p-3">Status</th><th className="p-3">Rationale</th></tr></thead>
          <tbody>
            {criteria.map((criterion) => (
              <tr className="border-t border-border" key={criterion.code}>
                <td className="p-3 font-medium">{criterion.code}</td>
                <td className="p-3">{criterion.strength}</td>
                <td className="p-3">
                  <Badge variant={criterion.met === "not_assessed" || criterion.met === "not_applicable" ? "secondary" : criterion.met ? "default" : "outline"}>
                    {criterion.met === "not_assessed" ? "not assessed" : criterion.met === "not_applicable" ? "not applicable" : criterion.met ? "met" : "not met"}
                  </Badge>
                </td>
                <td className="p-3 text-muted-foreground">{criterion.met === "not_assessed" || criterion.met === "not_applicable" ? criterion.reason : criterion.rationale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExternalAssertionList({ assertions }: { assertions: Array<{ source: string; track: string; classification: string; reviewStatus?: string; conditions: string[] }> }) {
  if (!assertions.length) {
    return <p className="mt-2 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">None found. External assertions (e.g. ClinVar/OncoKB labels) are shown here as opaque source records — never converted into an internal criterion.</p>;
  }
  return (
    <div className="mt-2 flex flex-col gap-2">
      {assertions.map((assertion, i) => (
        <div key={i} className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <span className="font-medium">{assertion.source}</span> ({assertion.track}): {assertion.classification}
          {assertion.reviewStatus ? <span className="text-muted-foreground"> — {assertion.reviewStatus}</span> : null}
          {assertion.conditions.length ? <span className="text-muted-foreground"> for {assertion.conditions.join(", ")}</span> : null}
        </div>
      ))}
    </div>
  );
}

function KeyValueGrid({ rows, extra }: { rows: Array<[string, string | undefined]>; extra?: unknown }) {
  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-muted/30 p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>{value?.startsWith("http") ? <a href={value} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-2 break-all text-sm text-primary hover:underline">{value}<ExternalLink /></a> : <p className="mt-1 text-sm">{value || "Not returned"}</p>}</div>)}
      </div>
      {extra ? <><Separator /><pre className="overflow-auto rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">{JSON.stringify(extra, null, 2)}</pre></> : null}
    </div>
  );
}

function SourceSectionTitle({ title, description }: { title: string; description: string }) {
  return <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3"><p className="font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>;
}

function SourceLinkList({ links }: { links: Array<{ label: string; url: string }> }) {
  if (!links.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {links.map((link) => (
        <Button asChild key={`${link.label}-${link.url}`} variant="outline" size="sm">
          <a href={link.url} target="_blank" rel="noreferrer">{link.label}<ExternalLink data-icon="inline-end" /></a>
        </Button>
      ))}
    </div>
  );
}

function TreatmentTable({ treatments }: { treatments: VariantReviewResponse["oncokb"]["therapeuticImplications"] }) {
  if (!treatments.length) {
    return <p className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">No OncoKB treatment entries were returned for this query.</p>;
  }
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Drugs</th><th className="p-3">Level</th><th className="p-3">FDA</th><th className="p-3">Cancer type</th><th className="p-3">Alterations</th><th className="p-3">PMIDs</th></tr></thead>
        <tbody>{treatments.map((treatment, index) => <tr className="border-t border-border" key={`${treatment.drugs.join("-")}-${index}`}><td className="p-3 font-medium">{treatment.drugs.join(", ") || "Not listed"}{treatment.description ? <span className="block text-xs text-muted-foreground">{treatment.description}</span> : null}</td><td className="p-3">{treatment.level ?? "Not listed"}</td><td className="p-3">{treatment.fdaLevel ?? "Not listed"}</td><td className="p-3">{treatment.cancerType ?? "Not listed"}</td><td className="p-3">{treatment.alterations.join(", ") || "Not listed"}</td><td className="p-3">{treatment.pmids.join(", ") || "Not listed"}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function ImplicationTable({ title, implications }: { title: string; implications: Array<Record<string, unknown>> }) {
  if (!implications.length) {
    return <p className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">No OncoKB {title.toLowerCase()} were returned for this query.</p>;
  }
  return (
    <div className="mt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-2 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Level</th><th className="p-3">Tumor type</th><th className="p-3">PMIDs</th><th className="p-3">Description</th></tr></thead>
          <tbody>
            {implications.map((implication, index) => {
              const tumorType = implication.tumorType as Record<string, unknown> | undefined;
              const pmids = Array.isArray(implication.pmids) ? implication.pmids.map(String) : [];
              return (
                <tr className="border-t border-border" key={index}>
                  <td className="p-3">{typeof implication.levelOfEvidence === "string" ? implication.levelOfEvidence : "Not listed"}</td>
                  <td className="p-3">{typeof tumorType?.name === "string" ? tumorType.name : "Not listed"}</td>
                  <td className="p-3">{pmids.join(", ") || "Not listed"}</td>
                  <td className="p-3">{typeof implication.description === "string" ? implication.description : "Not listed"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status, label }: { status?: SourceStatus; label?: string }) {
  const variant =
    status === "available"
      ? "default"
      : status === "permission_denied" || status === "query_failed" || status === "rate_limited" || status === "conflicting"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{label ? `${label}: ` : ""}{status ?? "idle"}</Badge>;
}

function formatCoordinate(coordinate?: { chrom: string; pos: number }) {
  return coordinate ? `${coordinate.chrom}:${coordinate.pos}` : "unavailable";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}

function LoadingState() {
  return <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 rounded-lg border border-border bg-muted/50" />)}</div>;
}

function EmptyState() {
  return <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center"><Search /><div><p className="font-medium">Run a variant review</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Results will populate source tabs with explicit available, not_found, query_failed, permission_denied, or not_applicable status labels.</p></div></div>;
}

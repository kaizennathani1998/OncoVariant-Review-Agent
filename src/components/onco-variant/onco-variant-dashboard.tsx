"use client";

import type React from "react";
import { useMemo, useState } from "react";
import { AlertTriangle, Clipboard, Database, Download, ExternalLink, FileJson, FlaskConical, Loader2, Search, ShieldCheck, Sparkles } from "lucide-react";
import { buildMarkdownReport } from "@/lib/onco-variant/report";
import type { GenomeBuild, SourceStatus, VariantReviewRequest, VariantReviewResponse } from "@/lib/onco-variant/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const EXAMPLE: VariantReviewRequest = {
  chrom: "chr17",
  pos: 7577121,
  ref: "C",
  alt: "T",
  build: "hg19",
  gene: "TP53",
  proteinChange: "p.R175H",
  cancerType: "AML",
};

type FormState = Omit<VariantReviewRequest, "pos"> & { pos: string };
const INITIAL_FORM: FormState = { ...EXAMPLE, pos: String(EXAMPLE.pos) };
const NPM1_EXAMPLE: FormState = {
  chrom: "chr5",
  pos: "170837547",
  ref: "G",
  alt: "GCCTG",
  build: "hg19",
  gene: "NPM1",
  proteinChange: "p.W288Cfs*12",
  cancerType: "AML",
};

export function OncoVariantDashboard() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [result, setResult] = useState<VariantReviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const requestBody = useMemo<VariantReviewRequest>(() => ({ ...form, pos: Number(form.pos) }), [form]);

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
                <Field label="Cancer"><Input value={form.cancerType ?? ""} onChange={(e) => update("cancerType", e.target.value)} /></Field>
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
          <SummaryCard title="Normalized" value={result?.normalizedVariant.genomicHgvs ?? "Awaiting review"} detail={result?.normalizedVariant.build ?? "hg19/hg38"} icon={FileJson} />
          <SummaryCard title="ClinVar" value={result?.clinvar.clinicalSignificance ?? "No result yet"} detail={result?.clinvar.reviewStatus ?? "Clinical significance"} icon={ShieldCheck} status={result?.clinvar.status} />
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
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Card className="rounded-lg border-border/80">
        <CardHeader>
          <CardTitle>Normalized variant</CardTitle>
          <CardDescription>Processed representation used for source queries. This is not source evidence.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MiniFact label="Genomic HGVS" value={v.genomicHgvs} />
          <MiniFact label="Gene" value={v.gene ?? "Not provided"} />
          <MiniFact label="Build supplied" value={v.build} />
          <MiniFact label="Cancer type" value={v.cancerType ?? "Not provided"} />
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
      <Button variant="outline" size="sm" onClick={onCopy} disabled={value === "unavailable"}>
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
    <Tabs defaultValue="clinvar">
      <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-lg">
        <TabsTrigger value="clinvar" className="px-3 py-2">ClinVar</TabsTrigger>
        <TabsTrigger value="oncokb" className="px-3 py-2">OncoKB</TabsTrigger>
        <TabsTrigger value="cbioportal" className="px-3 py-2">cBioPortal</TabsTrigger>
        <TabsTrigger value="summary" className="px-3 py-2">AI Summary</TabsTrigger>
      </TabsList>
      <TabsContent value="clinvar">
        <SourceSectionTitle title="ClinVar returned result" description="ClinVar interpretation fields from NCBI E-utilities. Verify the linked source page before clinical use." />
        <SourceLinkList links={result.clinvar.reviewLinks ?? []} />
        <KeyValueGrid rows={[["Clinical significance", result.clinvar.clinicalSignificance], ["Disease/condition", result.clinvar.diseaseCondition], ["Review status", result.clinvar.reviewStatus], ["Variation ID", result.clinvar.variationId], ["VCV accession", result.clinvar.vcvAccession], ["Gene", result.clinvar.gene], ["HGVS names", result.clinvar.hgvsNames.join("; ")], ["Source", result.clinvar.sourceLink], ["Caveat", result.clinvar.caveat]]} />
      </TabsContent>
      <TabsContent value="oncokb">
        <SourceSectionTitle title="OncoKB returned result" description="OncoKB oncogenicity, effect, and therapy assertions are tumor-type and access-level dependent." />
        <SourceLinkList links={result.oncokb.reviewLinks ?? []} />
        <KeyValueGrid rows={[
          ["Oncogenicity", result.oncokb.oncogenicity],
          ["Mutation effect", result.oncokb.mutationEffect],
          ["Mutation effect description", result.oncokb.mutationEffectDescription],
          ["Highest sensitive level", result.oncokb.highestSensitiveLevel],
          ["Highest FDA level", result.oncokb.highestFdaLevel],
          ["Diagnostic level", result.oncokb.highestDiagnosticImplicationLevel],
          ["Prognostic level", result.oncokb.highestPrognosticImplicationLevel],
          ["Drugs", result.oncokb.drugs.join(", ")],
          ["PMIDs", result.oncokb.citations.join(", ")],
          ["Source", result.oncokb.sourceLink],
          ["Caveat", result.oncokb.caveat],
        ]} />
        <TreatmentTable treatments={result.oncokb.therapeuticImplications} />
      </TabsContent>
      <TabsContent value="cbioportal">
        <SourceSectionTitle title="cBioPortal returned result" description="Real cBioPortal REST results filtered locally against the normalized protein/genomic target." />
        <SourceLinkList links={result.cbioportal.reviewLinks ?? []} />
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Study</th><th className="p-3">Tumor type</th><th className="p-3">Samples</th><th className="p-3">Mutations</th><th className="p-3">Protein changes</th></tr></thead>
            <tbody>{result.cbioportal.matchingStudies.map((study) => <tr key={study.studyId} className="border-t border-border"><td className="p-3 font-medium">{study.link ? <a className="text-primary hover:underline" href={study.link} target="_blank" rel="noreferrer">{study.name}</a> : study.name}<span className="block text-xs text-muted-foreground">{study.studyId}</span></td><td className="p-3">{study.cancerType ?? "Not listed"}</td><td className="p-3">{study.sampleCount ?? "Not listed"}</td><td className="p-3">{study.mutationCount ?? 0}</td><td className="p-3">{study.matchingProteinChanges?.join(", ") || "Not listed"}{study.approximateMatches ? <Badge className="mt-1" variant="secondary">approximate</Badge> : null}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{result.cbioportal.caveat}</p>
        <Separator className="my-4" />
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Queried studies</p>
        <div className="mt-2 grid gap-2">
          {result.cbioportal.queriedStudies.map((study) => <div className="rounded-lg border border-border bg-muted/25 p-3 text-xs" key={`${study.studyId}-${study.molecularProfileId ?? "none"}`}><span className="font-medium">{study.studyId}</span> · {study.status}{study.message ? <span className="text-muted-foreground"> · {study.message}</span> : null}</div>)}
        </div>
      </TabsContent>
      <TabsContent value="summary"><div className="mt-4 whitespace-pre-wrap rounded-lg border border-border bg-muted/35 p-4 text-sm leading-6">{result.aiSummary}</div></TabsContent>
    </Tabs>
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

function StatusBadge({ status, label }: { status?: SourceStatus; label?: string }) {
  const variant = status === "live" ? "default" : status === "mock" || status === "missing-token" || status === "error" || status === "unavailable" ? "destructive" : "secondary";
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
  return <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center"><Search /><div><p className="font-medium">Run a variant review</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Results will populate source tabs with explicit live, missing-token, not-found, or mock status labels.</p></div></div>;
}

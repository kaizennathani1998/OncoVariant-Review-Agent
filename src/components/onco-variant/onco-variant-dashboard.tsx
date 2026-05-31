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

  return (
    <main className="min-h-screen overflow-x-hidden bg-background">
      <div className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><FlaskConical /></div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">OncoVariant Review Agent</h1>
                <p className="text-sm text-muted-foreground">ClinVar, OncoKB, cBioPortal, and guarded AI synthesis for variant review.</p>
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
              <CardTitle>Variant input</CardTitle>
              <CardDescription>Enter genomic alleles and optional disease context for source-specific evidence retrieval.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex justify-start sm:justify-end">
                <Button variant="outline" onClick={() => setForm(INITIAL_FORM)}><Sparkles data-icon="inline-start" />TP53 R175H</Button>
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Normalized" value={result?.normalizedVariant.genomicHgvs ?? "Awaiting review"} detail={result?.normalizedVariant.build ?? "hg19/hg38"} icon={FileJson} />
          <SummaryCard title="ClinVar" value={result?.clinvar.clinicalSignificance ?? "No result yet"} detail={result?.clinvar.reviewStatus ?? "Clinical significance"} icon={ShieldCheck} status={result?.clinvar.status} />
          <SummaryCard title="OncoKB" value={result?.oncokb.oncogenicity ?? "Token-dependent"} detail={result?.oncokb.mutationEffect ?? "Oncogenicity and effect"} icon={Sparkles} status={result?.oncokb.status} />
          <SummaryCard title="cBioPortal" value={result ? `${result.cbioportal.matchingStudies.length} studies` : "No result yet"} detail={result?.cbioportal.caveat ?? "Study matching"} icon={Database} status={result?.cbioportal.status} />
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="rounded-lg border-border/80">
            <CardHeader><CardTitle>Evidence workspace</CardTitle><CardDescription>Source records, source caveats, and summary text generated only from retrieved data.</CardDescription></CardHeader>
            <CardContent>{isLoading ? <LoadingState /> : result ? <EvidenceTabs result={result} /> : <EmptyState />}</CardContent>
          </Card>
          <Card className="rounded-lg border-border/80">
            <CardHeader><CardTitle>Provenance</CardTitle><CardDescription>Normalized request, UCSC locus, and export actions.</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="rounded-lg border border-border bg-muted/35 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">UCSC Genome Browser</p>
                {result ? <a className="mt-2 flex items-center gap-2 text-sm text-primary hover:underline" href={result.ucscUrl} target="_blank" rel="noreferrer">Open ±50 bp locus<ExternalLink /></a> : <p className="mt-2 text-sm text-muted-foreground">Generated after review.</p>}
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" variant="outline" disabled={!result} onClick={copyJson}><Clipboard data-icon="inline-start" />{copied === "json" ? "Copied" : "Copy JSON"}</Button>
                <Button className="flex-1" variant="outline" disabled={!result} onClick={exportMarkdown}><Download data-icon="inline-start" />{copied === "markdown" ? "Exported" : "Markdown"}</Button>
              </div>
              <pre className="max-h-[520px] overflow-auto rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">{JSON.stringify(result ?? requestBody, null, 2)}</pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
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
      <TabsContent value="clinvar"><KeyValueGrid rows={[["Clinical significance", result.clinvar.clinicalSignificance], ["Disease/condition", result.clinvar.diseaseCondition], ["Review status", result.clinvar.reviewStatus], ["Variation ID", result.clinvar.variationId], ["VCV accession", result.clinvar.vcvAccession], ["Gene", result.clinvar.gene], ["HGVS names", result.clinvar.hgvsNames.join("; ")], ["Source", result.clinvar.sourceLink], ["Caveat", result.clinvar.caveat]]} /></TabsContent>
      <TabsContent value="oncokb"><KeyValueGrid rows={[["Oncogenicity", result.oncokb.oncogenicity], ["Mutation effect", result.oncokb.mutationEffect], ["Biological effect", result.oncokb.biologicalEffect], ["Evidence level", result.oncokb.evidenceLevel], ["Drugs", result.oncokb.drugs.join(", ")], ["Source", result.oncokb.sourceLink], ["Caveat", result.oncokb.caveat]]} extra={result.oncokb.therapeuticImplications} /></TabsContent>
      <TabsContent value="cbioportal">
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Study</th><th className="p-3">Tumor type</th><th className="p-3">Samples</th><th className="p-3">Frequency</th></tr></thead>
            <tbody>{result.cbioportal.matchingStudies.map((study) => <tr key={study.studyId} className="border-t border-border"><td className="p-3 font-medium">{study.name}<span className="block text-xs text-muted-foreground">{study.studyId}</span></td><td className="p-3">{study.cancerType ?? "Not listed"}</td><td className="p-3">{study.sampleCount ?? "Not listed"}</td><td className="p-3">{study.mutationFrequency ?? "Not calculated"}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{result.cbioportal.caveat}</p>
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

function StatusBadge({ status, label }: { status?: SourceStatus; label?: string }) {
  const variant = status === "live" ? "default" : status === "mock" || status === "missing-token" || status === "error" ? "destructive" : "secondary";
  return <Badge variant={variant}>{label ? `${label}: ` : ""}{status ?? "idle"}</Badge>;
}

function LoadingState() {
  return <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 rounded-lg border border-border bg-muted/50" />)}</div>;
}

function EmptyState() {
  return <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center"><Search /><div><p className="font-medium">Run a variant review</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Results will populate source tabs with explicit live, missing-token, not-found, or mock status labels.</p></div></div>;
}


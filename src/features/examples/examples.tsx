import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, ArrowRight } from "@/components/ui/icons";
import {
  onboardingSamples,
  onboardingSamplePresentation,
} from "../onboarding/samples";
import { getConnectionTask } from "../onboarding/connection-instructions";
export const examples = [
  {
    slug: "feedback",
    name: "Triage feedback",
    sample: "Group feedback",
    description: "Route bugs, feature requests, questions, and praise.",
  },
  {
    slug: "research",
    name: "Filter research",
    sample: "Filter research",
    description: "Find relevant evidence in a batch of abstracts.",
  },
  {
    slug: "documents",
    name: "Organize documents",
    sample: "Sort files",
    description: "Propose folders from document names and excerpts.",
  },
];
export function ExampleCards({
  navigate,
}: {
  navigate: (path: string) => void;
}) {
  return (
    <section className="flex flex-col gap-4" aria-label="Example workflows">
      <h2 className="text-base font-medium">Try classifier</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {examples.map((example) => (
          <button
            key={example.slug}
            onClick={() => navigate(`/app/examples/${example.slug}`)}
            className="flex flex-col gap-3 rounded-xl border border-border p-5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="text-sm font-medium">{example.name}</span>
            <span className="text-sm leading-6 text-muted-foreground">
              {example.description}
            </span>
            <span className="mt-auto flex items-center gap-2 text-xs">
              Try example <ArrowRight size={14} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
export function ExamplePage({
  slug,
  demo,
  navigate,
}: {
  slug?: string;
  demo: boolean;
  navigate: (path: string) => void;
}) {
  const example = examples.find((item) => item.slug === slug);
  const [mode, setMode] = useState("agent");
  if (!example)
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          title="Examples"
          description="Complete tasks with supplied data, ready to paste."
        />
        <ExampleCards navigate={navigate} />
      </div>
    );
  const sample = onboardingSamples[example.sample];
  return (
    <div className="flex flex-col gap-6">
      <Button
        variant="ghost"
        className="self-start"
        onClick={() => navigate("/app/examples")}
      >
        <ArrowLeft /> All examples
      </Button>
      <PageHeader
        title={example.name}
        description={onboardingSamplePresentation[example.sample].outcome}
      />
      <Tabs value={mode} onValueChange={(value) => setMode(String(value))}>
        <TabsList aria-label="Example format">
          <TabsTrigger value="agent">Use with an agent</TabsTrigger>
          <TabsTrigger value="api">Use with the API</TabsTrigger>
        </TabsList>
        {["agent", "api"].map((value) => (
          <TabsContent key={value} value={value}>
            <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-border p-5">
              <p className="text-sm text-muted-foreground">
                {value === "agent"
                  ? "Paste this task into your connected agent. It uses the supplied example data."
                  : "Send this JSON body to POST /v1/classify using your API key."}
              </p>
              <pre
                tabIndex={0}
                className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words text-xs leading-6"
              >
                {value === "agent"
                  ? getConnectionTask(sample, demo)
                  : JSON.stringify(sample, null, 2)}
              </pre>
              <CopyButton
                value={
                  value === "agent"
                    ? getConnectionTask(sample, demo)
                    : JSON.stringify(sample, null, 2)
                }
                label={value === "agent" ? "Copy task" : "Copy JSON"}
              />
            </div>
          </TabsContent>
        ))}
      </Tabs>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => navigate("/app/agents")}>
          Set up an agent
        </Button>
        <Button
          variant="ghost"
          render={<a href="/developers" target="_blank" rel="noreferrer" />}
        >
          API documentation <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

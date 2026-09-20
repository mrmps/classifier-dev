import { useEffect, useState } from "react";
import type { AppSnapshot, AppAction, ActionResult } from "@/server/contracts";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentSetup } from "../agents/agent-setup";
import { KeyAccess } from "../keys/key-access";
import { onboardingSamples } from "./samples";

type SetupProps = {
  snapshot: AppSnapshot;
  act: (action: AppAction) => Promise<ActionResult>;
  initialTask?: string;
  initialPurpose?: "agent" | "api";
  onDone?: () => void;
  doneLabel?: string;
};

/** Both entry points share the same explicit credential creation and setup. */
export function ConnectionSetup({
  snapshot,
  act,
  initialTask = "Filter research",
  initialPurpose,
  onDone,
  doneLabel = "Go to overview",
}: SetupProps) {
  const [purpose, setPurpose] = useState(
    initialPurpose ?? snapshot.onboarding.intent,
  );
  return (
    <div className="flex flex-col gap-6">
      <Tabs
        value={purpose}
        onValueChange={(value) => {
          const intent = value === "api" ? "api" : "agent";
          setPurpose(intent);
          void act({ type: "intent", intent }).catch(() => {});
        }}
        className="gap-8"
      >
        <TabsList
          aria-label="How will you use classifier?"
          className="max-w-full flex-wrap h-auto"
        >
          <TabsTrigger value="agent">Use with an agent</TabsTrigger>
          <TabsTrigger value="api">Build with the API</TabsTrigger>
        </TabsList>
        <TabsContent value="agent" keepMounted className="data-[hidden]:hidden">
          <AgentSetup snapshot={snapshot} act={act} initialTask={initialTask} />
        </TabsContent>
        <TabsContent value="api" keepMounted className="data-[hidden]:hidden">
          <ApiSetup snapshot={snapshot} act={act} />
        </TabsContent>
      </Tabs>
      {onDone && (
        <Button variant="ghost" className="self-start" onClick={onDone}>
          {doneLabel}
        </Button>
      )}
    </div>
  );
}

export function ApiSetup({
  snapshot,
  act,
  showKey = true,
}: Pick<SetupProps, "snapshot" | "act"> & { showKey?: boolean }) {
  const [keyId, setKeyId] = useState("");
  const [origin, setOrigin] = useState("");
  const [method, setMethod] = useState("manual");
  const [language, setLanguage] = useState("curl");
  const canManage =
    snapshot.organizations?.active.role === "owner" ||
    snapshot.organizations?.active.role === "admin";
  const agent = snapshot.agents.find((item) => item.id === keyId);
  const key = agent && agent.status !== "revoked" ? { id: keyId } : null;
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!key || agent?.status !== "pending") return;
    let checks = 0;
    const timer = setInterval(() => {
      if (++checks > 40) return clearInterval(timer);
      if (document.visibilityState === "visible")
        void act({ type: "refresh" }).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [key?.id, agent?.status, act]);
  const sample = onboardingSamples["Group feedback"];
  const code = `curl '${origin}/v1/classify' \\\n  -H "Authorization: Bearer $CLASSIFIER_API_KEY" \\\n  -H 'Content-Type: application/json' \\\n  --data-binary @- <<'JSON'\n${JSON.stringify(sample, null, 2)}\nJSON`;
  const snippets: Record<string, string> = {
    curl: code,
    javascript: `const response = await fetch("${origin}/v1/classify", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.CLASSIFIER_API_KEY}\`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${JSON.stringify(sample, null, 2)})
});
if (!response.ok) throw new Error(await response.text());
console.log(await response.json());`,
    python: `import os
import json
import urllib.request

request = urllib.request.Request(
    "${origin}/v1/classify",
    data=json.dumps(${JSON.stringify(sample, null, 2)}).encode(),
    headers={
        "Authorization": "Bearer " + os.environ["CLASSIFIER_API_KEY"],
        "Content-Type": "application/json",
    },
    method="POST",
)
with urllib.request.urlopen(request) as response:
    print(json.load(response))`,
  };
  const prompt = `Add classification to this application using ${origin}/v1/classify. Read ${origin}/developers for the API contract. Keep CLASSIFIER_API_KEY in a server-side environment variable; ask me to configure it securely. Never put the key in client code, logs, or source control. Start with this request body: ${JSON.stringify(sample)}. Handle non-success responses and show each result's label. Run a real request to verify the integration once the environment is configured.`;
  return (
    <section className="flex flex-col gap-6" aria-labelledby="api-setup-title">
      <div className="flex flex-col gap-2">
        <h2 id="api-setup-title" className="text-base font-medium">
          Add classification to your app
        </h2>
        <p className="text-sm text-muted-foreground">
          Use your Default key or a named key in your server environment, then
          make your first request.
        </p>
      </div>
      {showKey && (
        <KeyAccess snapshot={snapshot} act={act} onSelect={setKeyId} />
      )}
      <Tabs
        value={method}
        onValueChange={(value) => setMethod(String(value))}
        className="gap-4"
      >
        <TabsList aria-label="API setup method">
          <TabsTrigger value="prompt">Integration prompt</TabsTrigger>
          <TabsTrigger value="manual">API request</TabsTrigger>
        </TabsList>
        {["prompt", "manual"].map((value) => (
          <TabsContent key={value} value={value}>
            <div className="flex h-64 flex-col gap-3 rounded-lg border border-border p-4">
              <p className="text-sm text-muted-foreground">
                {value === "prompt"
                  ? "Give this prompt to your coding agent. Your key is not included."
                  : "Set CLASSIFIER_API_KEY in your terminal before running this request."}
              </p>
              {value === "manual" && (
                <Tabs
                  value={language}
                  onValueChange={(value) => setLanguage(String(value))}
                >
                  <TabsList aria-label="Request language">
                    <TabsTrigger value="curl">cURL</TabsTrigger>
                    <TabsTrigger value="javascript">JavaScript</TabsTrigger>
                    <TabsTrigger value="python">Python</TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
              <pre
                tabIndex={0}
                className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all text-xs leading-6"
              >
                <code>{value === "prompt" ? prompt : snippets[language]}</code>
              </pre>
              <CopyButton
                value={value === "prompt" ? prompt : snippets[language]}
                label={
                  value === "prompt"
                    ? "Copy integration prompt"
                    : "Copy request"
                }
              />
            </div>
          </TabsContent>
        ))}
      </Tabs>
      {key && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm text-muted-foreground">
            {agent?.status === "connected"
              ? "First successful request verified. Your API key works."
              : agent?.status === "paused"
                ? "This key is paused. Resume it in API keys."
                : "Waiting for your first successful API request."}
          </p>
          <Button
            variant="ghost"
            onClick={() => void act({ type: "refresh" }).catch(() => {})}
          >
            Refresh status
          </Button>
        </div>
      )}
    </section>
  );
}

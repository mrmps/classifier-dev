import { useEffect, useState } from "react";
import type { ActionResult, AppAction, AppSnapshot } from "@/server/contracts";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ArrowUpRight, CheckCircle } from "@/components/ui/icons";
import {
  getConnectionInstructions,
  getAgentSetupPrompt,
  getConnectionTask,
} from "../onboarding/connection-instructions";
import {
  onboardingSamples,
  onboardingSamplePresentation,
} from "../onboarding/samples";

import { KeyAccess } from "../keys/key-access";

const setupClients = ["Claude Code", "Codex", "Cursor", "ChatGPT", "Other"];

/** One setup surface: enrollment, configuration, and verification stay together. */
export function AgentSetup({
  snapshot,
  act,
  initialTask,
  selectedClient,
}: {
  snapshot: AppSnapshot;
  act: (action: AppAction) => Promise<ActionResult>;
  initialTask: string;
  selectedClient?: string;
}) {
  const [setupMethod, setSetupMethod] = useState("prompt");
  const [client, setClient] = useState(selectedClient ?? "Claude Code");
  const [task, setTask] = useState(initialTask);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const [keyId, setKeyId] = useState("");
  const agent = snapshot.agents.find((item) => item.id === keyId);
  const connection =
    agent && agent.status !== "revoked" ? { id: agent.id } : undefined;
  const pending = agent?.status === "pending";
  useEffect(() => {
    if (!pending) return;
    let checks = 0;
    const timer = setInterval(() => {
      if (++checks > 40) return clearInterval(timer);
      if (document.visibilityState === "visible")
        void act({ type: "refresh" }).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [pending, act]);

  const instructions = getConnectionInstructions({
    client,
    secret: "YOUR_API_KEY",
    origin,
    demo: snapshot.demo,
  });
  const needsEnvironment = client === "Cursor" || client === "Other";
  const sample =
    onboardingSamples[task] || onboardingSamples["Filter research"];

  const taskPrompt = getConnectionTask(sample, snapshot.demo);
  const presentation = onboardingSamplePresentation[task];

  return (
    <section
      className="flex min-w-0 flex-col gap-7"
      aria-labelledby="connect-agent-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="connect-agent-title" className="text-base font-medium">
          {selectedClient
            ? `Set up ${selectedClient === "Other" ? "MCP" : selectedClient}`
            : "Connect an agent"}
        </h2>
        <Button
          variant="link"
          size="sm"
          render={
            <a
              href="https://classifier.dev/mcp-setup"
              target="_blank"
              rel="noreferrer"
            />
          }
        >
          Setup guide <ArrowUpRight data-icon="inline-end" />
        </Button>
      </div>
      <Tabs
        value={client}
        onValueChange={(value) => {
          setClient(String(value));
        }}
        className="gap-6"
      >
        {!selectedClient && (
          <TabsList
            aria-label="Agent client"
            className="max-w-full flex-wrap h-auto"
          >
            {setupClients.map((name) => (
              <TabsTrigger
                key={name}
                value={name}
                className="px-3"
                aria-label={name === "Other" ? "MCP" : name}
              >
                {name === "Other"
                  ? "MCP"
                  : name === "Claude Code"
                    ? "Claude"
                    : name}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        {(selectedClient ? [selectedClient] : setupClients).map((name) => (
          <TabsContent key={name} value={name} className="flex flex-col gap-6">
            {name === "ChatGPT" ? (
              <div className="flex min-h-80 flex-col gap-3">
                <h3 className="text-sm font-medium">
                  ChatGPT workspace connection requires hosted OAuth
                </h3>
                <p className="max-w-lg text-sm leading-6 text-muted-foreground">
                  Connecting ChatGPT to this workspace is not available yet.
                  Use Claude Code, Codex, Cursor, or another compatible MCP
                  client to track usage here. The public MCP server can be used
                  in ChatGPT without workspace attribution.
                </p>
                <a
                  className="self-start text-sm underline underline-offset-4"
                  href="/mcp-setup"
                  target="_blank"
                  rel="noreferrer"
                >
                  Public MCP setup guide
                </a>
              </div>
            ) : (
              <>
                <div className="grid min-h-24 items-center gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">
                      1. Choose an API key
                    </h3>
                    <p className="max-w-md text-sm leading-6 text-muted-foreground">
                      Default works with every supported client. Choose another
                      key, or create a named key to track this agent separately.
                    </p>
                  </div>
                  <KeyAccess
                    snapshot={snapshot}
                    act={act}
                    onSelect={setKeyId}
                  />
                </div>
                <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">
                      2. Set up your agent
                    </h3>
                    <p className="max-w-md text-sm leading-6 text-muted-foreground">
                      Give your agent the setup prompt, or configure the
                      connection manually. The prompt does not include your key.
                    </p>
                    <p className="max-w-md text-xs leading-5 text-muted-foreground">
                      {needsEnvironment
                        ? "Set CLASSIFIER_API_KEY in your client’s environment to use the configuration below."
                        : connection
                          ? "Replace YOUR_API_KEY in the manual setup with the key you selected."
                          : "Replace YOUR_API_KEY in the manual instructions with your existing key, or create one above."}
                    </p>
                  </div>
                  <Tabs
                    value={setupMethod}
                    onValueChange={(value) => setSetupMethod(String(value))}
                    className="gap-3"
                  >
                    <TabsList aria-label="Agent setup method">
                      <TabsTrigger value="prompt">Setup prompt</TabsTrigger>
                      <TabsTrigger value="manual">Manual setup</TabsTrigger>
                    </TabsList>
                    {["prompt", "manual"].map((method) => (
                      <TabsContent key={method} value={method}>
                        <div className="flex h-64 min-w-0 flex-col gap-3 overflow-hidden rounded-lg border border-border bg-background p-4">
                          <p className="text-xs leading-5 text-muted-foreground">
                            {method === "prompt"
                              ? "Paste into your coding agent. Provide the key through secure configuration when asked."
                              : instructions.description}
                          </p>
                          <pre
                            tabIndex={0}
                            aria-label={
                              method === "prompt"
                                ? "Agent setup prompt"
                                : "Manual setup configuration"
                            }
                            className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-6"
                          >
                            <code>
                              {method === "prompt"
                                ? getAgentSetupPrompt(
                                    client,
                                    origin,
                                    snapshot.demo,
                                  )
                                : instructions.setup}
                            </code>
                          </pre>
                          {
                            <CopyButton
                              value={
                                method === "prompt"
                                  ? getAgentSetupPrompt(
                                      client,
                                      origin,
                                      snapshot.demo,
                                    )
                                  : instructions.setup
                              }
                              label={
                                method === "prompt"
                                  ? "Copy setup prompt"
                                  : needsEnvironment
                                    ? "Copy configuration"
                                    : "Copy command"
                              }
                            />
                          }
                        </div>
                      </TabsContent>
                    ))}
                  </Tabs>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-4">
                  <div className="flex h-14 items-center justify-between gap-3 text-xs leading-5 text-muted-foreground lg:col-start-2">
                    <p className="max-w-md">
                      {connection && needsEnvironment
                        ? "Set CLASSIFIER_API_KEY in the environment your client inherits."
                        : snapshot.demo
                          ? "Keep this local server running while your agent uses it."
                          : "Your credential is private. Keep it out of source control."}
                    </p>
                  </div>
                </div>
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
      {client !== "ChatGPT" && (
        <section
          className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]"
          aria-label="Try a task"
        >
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">
              3. Try your first classification
            </h3>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              Try a complete workflow with the included example data. Copy the
              prompt into your connected agent to see the results.
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <ToggleGroup
              value={[task]}
              onValueChange={(values) => values[0] && setTask(values[0])}
              size="sm"
              aria-label="Task to try"
              className="flex-wrap"
            >
              {["Filter research", "Group feedback", "Sort files"].map(
                (value) => (
                  <ToggleGroupItem key={value} value={value}>
                    {value}
                  </ToggleGroupItem>
                ),
              )}
            </ToggleGroup>
            <div className="flex flex-col overflow-hidden rounded-lg border border-border">
              <div className="flex flex-col gap-2 border-b border-border p-4">
                <p className="text-sm font-medium">{presentation.summary}</p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {presentation.outcome}
                </p>
              </div>
              <pre
                tabIndex={0}
                aria-label={`${task} prompt preview`}
                className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6"
              >
                {taskPrompt}
              </pre>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  {sample.inputs.length} example items · ready to paste
                </span>
                <CopyButton value={taskPrompt} label="Copy task" />
              </div>
            </div>
            {connection && (
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <span role="status" className="flex items-center gap-2">
                  {agent?.status === "connected" && <CheckCircle size={16} />}
                  {agent?.status === "connected"
                    ? "A successful request was observed for this key."
                    : agent?.status === "paused"
                      ? "This API key is paused. Resume it in API keys."
                      : "Waiting for the first successful request."}
                </span>
                {pending && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void act({ type: "refresh" }).catch(() => {})
                    }
                  >
                    Refresh status
                  </Button>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </section>
  );
}

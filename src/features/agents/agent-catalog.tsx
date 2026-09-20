import { ExampleCards } from "../examples/examples";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import {
  ArrowLeft,
  ArrowRight,
  Link2,
} from "@/components/ui/icons";
import type { ElementType } from "react";
import type { ActionResult, AppAction, AppSnapshot } from "@/server/contracts";
import { AgentSetup } from "./agent-setup";

type Client = {
  name: string;
  description: string;
  logo?: string;
  icon?: ElementType;
};

const clients: Client[] = [
  {
    name: "Claude Code",
    description:
      "Connect Claude Code to classification tools in your terminal.",
    logo: "/icons/agents/claude.svg",
  },
  {
    name: "Codex",
    description: "Add classification tools to your Codex workflow.",
    logo: "/icons/agents/codex.svg",
  },
  {
    name: "Cursor",
    description: "Use classifier from your editor’s agent.",
    logo: "/icons/agents/cursor.svg",
  },
  {
    name: "Other",
    description:
      "Connect another client that supports Streamable HTTP and bearer authentication.",
    icon: Link2,
  },
];

function ClientLogo({
  name,
  logo,
  icon: Icon,
  className = "size-5",
}: {
  name: string;
  logo?: string;
  icon?: ElementType;
  className?: string;
}) {
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        aria-hidden="true"
        className={`${className} shrink-0 object-contain dark:invert`}
      />
    );
  }

  return Icon ? (
    <Icon aria-label={`${name} icon`} className={`${className} shrink-0`} />
  ) : null;
}

export function AgentCatalog({
  snapshot,
  act,
  clientSlug,
  navigate,
}: {
  clientSlug?: string;
  navigate: (path: string) => void;
  snapshot: AppSnapshot;
  act: (action: AppAction) => Promise<ActionResult>;
}) {
  const selected = (
    {
      "claude-code": "Claude Code",
      codex: "Codex",
      cursor: "Cursor",
      custom: "Other",
    } as Record<string, string>
  )[clientSlug || ""];
  const selectClient = (name: string) =>
    navigate(
      `/app/agents/${name === "Other" ? "custom" : name.toLowerCase().replaceAll(" ", "-")}`,
    );
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const client = clients.find((item) => item.name === selected);
  if (client)
    return (
      <div className="flex min-w-0 flex-col gap-7">
        <Button
          variant="ghost"
          className="self-start"
          onClick={() => navigate("/app/agents")}
        >
          <ArrowLeft data-icon="inline-start" /> All clients
        </Button>
        <div className="flex items-center gap-4 rounded-xl border border-border p-6">
          <ClientLogo
            name={client.name}
            logo={client.logo}
            icon={client.icon}
            className="size-7"
          />
          <PageHeader
            title={client.name === "Other" ? "Custom MCP client" : client.name}
            description={client.description}
          />
        </div>
        <div className="rounded-xl border border-border p-5 sm:p-6">
          <AgentSetup
            key={client.name}
            selectedClient={client.name}
            snapshot={snapshot}
            act={act}
            initialTask="Filter research"
          />
        </div>
      </div>
    );
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader
        title="Agents & MCP"
        description="Add classifier to the tools you already use."
      />
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
          <section
            className="overflow-hidden rounded-xl border border-border"
            aria-labelledby="coding-clients-title"
          >
            <h2
              id="coding-clients-title"
              className="px-5 pt-5 text-base font-medium"
            >
              Connect your coding agent
            </h2>
            <div className="px-5 pb-2 pt-3">
              {clients.slice(0, 3).map(({ name, logo, icon }) => (
                <div
                  key={name}
                  className="flex items-center justify-between gap-3 border-b border-border/60 py-4 last:border-0"
                >
                  <span className="flex items-center gap-3 text-sm font-medium">
                    <ClientLogo name={name} logo={logo} icon={icon} />
                    {name}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Set up ${name}`}
                    onClick={() => selectClient(name)}
                  >
                    Set up <ArrowRight data-icon="inline-end" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
          <section
            className="flex flex-col gap-4 rounded-xl border border-border p-5"
            aria-labelledby="chat-clients-title"
          >
            <div className="flex items-center gap-3">
              <span className="flex shrink-0 items-center gap-1.5">
                <img
                  src="/icons/agents/codex.svg"
                  alt=""
                  aria-hidden="true"
                  className="size-5 object-contain dark:invert"
                />
                <img
                  src="/icons/agents/claude.svg"
                  alt=""
                  aria-hidden="true"
                  className="size-5 object-contain dark:invert"
                />
              </span>
              <h2 id="chat-clients-title" className="text-base font-medium">
                ChatGPT & Claude
              </h2>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              Workspace connections for hosted chat apps are not available yet.
              Use a coding agent above to track usage here. ChatGPT and Claude
              can use the public service without workspace attribution.
            </p>
            <a
              className="self-start text-xs underline underline-offset-4"
              href="/mcp-setup"
              target="_blank"
              rel="noreferrer"
            >
              Public MCP setup guide
            </a>
          </section>
          <section className="flex items-center justify-between gap-4 rounded-xl border border-border p-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium">Another MCP client</h2>
              <p className="text-xs leading-5 text-muted-foreground">
                Server URL, authentication, and configuration.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => selectClient("Other")}
            >
              Set up <ArrowRight data-icon="inline-end" />
            </Button>
          </section>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <section
            className="flex min-w-0 flex-col gap-4 rounded-xl border border-border p-5"
            aria-labelledby="mcp-title"
          >
            <h2 id="mcp-title" className="text-base font-medium">
              MCP server
            </h2>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <code className="break-all text-xs">
                {origin ? `${origin}/mcp` : "Loading server URL…"}
              </code>
              {origin && (
                <CopyButton value={`${origin}/mcp`} label="Copy URL" />
              )}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Authenticate with an API key using a Bearer header.
              {snapshot.demo
                ? " This local server must stay running and is only reachable from your computer."
                : " Uses Streamable HTTP."}
            </p>
          </section>
          <section
            className="flex min-w-0 flex-col gap-4 rounded-xl border border-border p-5"
            aria-labelledby="cli-title"
          >
            <h2 id="cli-title" className="text-base font-medium">
              Use classifier via CLI
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Classify text and files from your terminal. Requires Node.js.
            </p>
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4">
              <code className="break-all text-xs leading-6">
                npm install -g classifier-dev
              </code>
              <CopyButton
                value="npm install -g classifier-dev"
                label="Copy install command"
              />
            </div>
            <pre
              className="overflow-x-auto rounded-lg border border-border p-4 text-xs leading-7"
              tabIndex={0}
              aria-label="CLI example"
            >
              <code>
                {'classify bug,feature,praise "Love the new dashboard"'}
              </code>
            </pre>
            <p className="text-xs leading-5 text-muted-foreground">
              Set CLASSIFY_API_KEY in your environment to attribute requests to
              your workspace.
              {snapshot.demo
                ? " Set CLASSIFY_ENDPOINT to this server’s /v1/classify endpoint for local usage."
                : ""}
            </p>
          </section>
        </div>
      </div>
      <ExampleCards navigate={navigate} />
      <p className="text-sm leading-6 text-muted-foreground">
        Manage credentials in{" "}
        <a
          className="text-foreground underline underline-offset-4"
          href="/app/keys"
        >
          API keys
        </a>
        . All clients share your workspace balance. Use a separate key per
        client to distinguish its usage.
      </p>
    </div>
  );
}

import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useState } from "react";
import type { OnboardingSample } from "./samples";
import {
  getConnectionInstructions,
  getConnectionTask,
} from "./connection-instructions";
import { CopyButton } from "../../components/ui/copy-button";
import { Button } from "../../components/ui/button";
import {
  LoaderCircle,
  ArrowRight,
  Lock,
  InfoIcon,
} from "../../components/ui/icons";
export function ConnectionStep({
  client,
  secret,
  sample,
  busy,
  onVerify,
  onCheck,
  demo,
}: {
  client: string;
  secret: string;
  sample: OnboardingSample;
  busy: boolean;
  onVerify: () => void;
  onCheck: () => void;
  demo: boolean;
}) {
  const api = client === "your app";
  const [tab, setTab] = useState<"setup" | "test">(api ? "test" : "setup");
  const origin =
    typeof window === "undefined"
      ? "http://localhost:3000"
      : window.location.origin;
  const { setup, description, fileName } = getConnectionInstructions({
    client,
    secret,
    origin,
    demo,
  });
  const command = [
    `curl ${origin}/v1/classify`,
    `  -H 'Authorization: Bearer ${secret}'`,
    `  -H 'Content-Type: application/json'`,
    `  -d '${JSON.stringify(sample).replaceAll("'", "'\"'\"'")}'`,
  ].join(" \\\n");
  const task = getConnectionTask(sample, demo);
  return (
    <>
      <div className="step-heading">
        <h1 tabIndex={-1}>
          {api ? "Make your first request." : `Connect ${client}.`}
        </h1>
        <p>
          {api
            ? "Your credential is ready. Make your first API request."
            : "Add the connection, then ask your agent to try it."}
        </p>
      </div>
      {!api && (
        <ToggleGroup
          value={[tab]}
          onValueChange={(values) => {
            if (values[0]) setTab(values[0] as "setup" | "test");
          }}
          aria-label="Connection method"
        >
          <ToggleGroupItem value="setup">Agent setup</ToggleGroupItem>
          <ToggleGroupItem value="test">Test request</ToggleGroupItem>
        </ToggleGroup>
      )}
      {tab === "setup" ? (
        <section id="connection-setup" aria-label="Agent setup">
          {client === "ChatGPT" ? (
            <Alert>
              <AlertTitle>ChatGPT cannot reach this local server.</AlertTitle>
              <AlertDescription>
                This demo runs on your computer. ChatGPT requires a publicly
                reachable HTTPS MCP server and a supported authentication flow.
                Use Claude Code, Codex, or Cursor locally, or test this
                credential below.
              </AlertDescription>
              <Button variant="outline" onClick={() => setTab("test")}>
                Test the API instead <ArrowRight data-icon="inline-end" />
              </Button>
            </Alert>
          ) : (
            <>
              <div className="connection-instruction">
                <strong>1. Add classifier to {client}</strong>
                <p>{description}</p>
              </div>
              {(client === "Cursor" || client === "Other") && (
                <div className="code-panel setup-secret">
                  <div className="code-header">
                    <span>CLASSIFIER_API_KEY · shown once</span>
                    <CopyButton value={secret} label="Copy key" />
                  </div>
                  <pre tabIndex={0}>{secret}</pre>
                </div>
              )}
              <div className="code-panel">
                <div className="code-header">
                  <span>{fileName}</span>
                  <CopyButton
                    value={setup}
                    label={
                      client === "Claude Code" || client === "Codex"
                        ? "Copy commands"
                        : "Copy config"
                    }
                  />
                </div>
                <pre tabIndex={0}>{setup}</pre>
              </div>
              <div className="connection-instruction">
                <strong>2. Ask your agent to try it</strong>
                <p>
                  This prompt contains no credential. Paste it into {client}{" "}
                  after connecting.
                </p>
              </div>
              <div className="code-panel">
                <div className="code-header">
                  <span>First task</span>
                  <CopyButton value={task} label="Copy task prompt" />
                </div>
                <pre tabIndex={0}>{task}</pre>
              </div>
              <p className="subtle-note">
                <InfoIcon size={16} aria-hidden="true" />
                {demo
                  ? "Keep the local development server running while your agent uses it."
                  : "We will verify the first successful classification automatically."}
              </p>
              <p className="tiny muted connection-wait" role="status">
                Waiting for your first classification. Copying setup
                instructions does not mark the connection as verified.
              </p>
            </>
          )}
        </section>
      ) : (
        <section id="connection-test" aria-label="Test request">
          <div className="code-panel">
            <div className="code-header">
              <span>First classification</span>
              <CopyButton value={command} label="Copy command" />
            </div>
            <pre tabIndex={0}>{command}</pre>
          </div>
          <Alert>
            <AlertTitle>
              {demo ? "Try a real request locally" : "Verify your credential"}
            </AlertTitle>
            <AlertDescription>
              {demo
                ? "Run the command in your terminal, or send a request from this browser. Classification runs through classifier.dev; usage is saved locally. Browser verification tests the credential, not installation in your agent."
                : "Run the command from your client. We will confirm the first successful request automatically."}
            </AlertDescription>
            {demo && (
              <Button variant="default" disabled={busy} onClick={onVerify}>
                {busy ? (
                  <LoaderCircle
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <ArrowRight data-icon="inline-end" />
                )}{" "}
                Run first classification
              </Button>
            )}
          </Alert>
        </section>
      )}
      <Button variant="outline" onClick={onCheck} disabled={busy}>
        Check connection
      </Button>
      <p className="subtle-note">
        <Lock size={16} aria-hidden="true" />
        This credential is shown once. Keep it private. It can classify within
        your shared workspace balance and cannot add funds.
      </p>
    </>
  );
}

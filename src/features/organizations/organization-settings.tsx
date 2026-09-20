import { useEffect, useState } from "react";
import type { OrganizationContext } from "@/server/organization-contracts";
import type { OrganizationActionHandler } from "./workspace-switcher";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/copy-button";
import {
  NativeSettingsSection,
  NativeSettingsRow,
} from "@/components/shared/settings-section-primitives";

export function OrganizationSettings({
  context,
  onAction,
}: {
  context: OrganizationContext;
  onAction: OrganizationActionHandler;
}) {
  const [name, setName] = useState(context.active.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setName(context.active.name);
  }, [context.active.id, context.active.name]);
  useEffect(() => {
    setMessage("");
    setError("");
  }, [context.active.id]);
  const canEdit =
    context.mode === "demo" &&
    context.active.kind === "organization" &&
    context.active.role !== "member";
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={
          context.active.kind === "personal"
            ? "Personal workspace"
            : "Organization"
        }
        description="Workspace identity and shared access."
      />
      <NativeSettingsSection title="General">
        <NativeSettingsRow
          title="Name"
          description="Shown in the workspace switcher."
        >
          <form
            className="flex w-full items-end gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || !canEdit) return;
              setBusy(true);
              setMessage("");
              setError("");
              try {
                await onAction({ type: "rename", name: name.trim() });
                setMessage("Organization name saved.");
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Could not save the name.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor="workspace-name" className="sr-only">
                Workspace name
              </FieldLabel>
              <Input
                id="workspace-name"
                value={name}
                maxLength={80}
                onChange={(event) => {
                  setName(event.target.value);
                  setMessage("");
                  setError("");
                }}
                disabled={!canEdit || busy}
                required
              />
            </Field>
            <Button
              variant="outline"
              type="submit"
              disabled={
                !canEdit ||
                busy ||
                !name.trim() ||
                name.trim() === context.active.name
              }
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </form>
        </NativeSettingsRow>
        <NativeSettingsRow
          title="Workspace ID"
          description="Use this identifier when contacting support."
        >
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <code className="break-all text-xs text-muted-foreground">
              {context.active.id}
            </code>
            <CopyButton value={context.active.id} label="Copy ID" />
          </div>
        </NativeSettingsRow>
        <NativeSettingsRow
          title="Your access"
          description="Permissions are checked for every account action."
        >
          <span className="text-sm capitalize">{context.active.role}</span>
        </NativeSettingsRow>
      </NativeSettingsSection>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
        {context.active.kind === "personal"
          ? "This workspace belongs to you. Create an organization from the workspace switcher to manage a team separately."
          : "Agents, API keys, usage, and billing are shared within this organization. Switching workspaces keeps each organization’s data separate."}
      </p>
    </div>
  );
}

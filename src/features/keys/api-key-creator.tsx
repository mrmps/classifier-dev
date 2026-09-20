import { useId, useState } from "react";
import { IconPlusOutline18 } from "nucleo-ui-essential-outline-18";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { ActionResult, AppAction } from "@/server/contracts";

export type CreatedApiKey = { id: string; secret: string };

/** The same create-and-save flow is used for applications and MCP clients. */
export function ApiKeyCreator({
  credential,
  canManage,
  act,
  onCreated,
  onBusyChange,
  onSaved,
}: {
  credential?: CreatedApiKey | null;
  canManage: boolean;
  act: (action: AppAction) => Promise<ActionResult>;
  onCreated: (key: CreatedApiKey) => void;
  onBusyChange?: (busy: boolean) => void;
  onSaved?: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    if (!canManage || busy || !name.trim()) return;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      const result = await act({ type: "create-key", name: name.trim() });
      if (!result.secret || !result.agentId)
        throw new Error("No API key was returned. Try again.");
      onCreated({ id: result.agentId, secret: result.secret });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create the API key. Try again.",
      );
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  const content = credential ? (
    <div className="flex flex-col gap-3">
      <code className="select-all break-all text-xs leading-6">
        {credential.secret}
      </code>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Keep this key private. Owners and admins can reveal it later.
        </p>
        <CopyButton value={credential.secret} label="Copy API key" />
      </div>
    </div>
  ) : (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <Field>
        <FieldLabel htmlFor={id}>Key name</FieldLabel>
        <div className="flex flex-col gap-3">
          <Input
            id={id}
            className="w-full"
            placeholder="e.g. Customer feedback app"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            disabled={busy || !canManage}
          />
        </div>
      </Field>
      <p className="text-xs leading-5 text-muted-foreground">
        {canManage
          ? "Use a separate key for each app or agent to track its usage."
          : "Ask a workspace owner or admin to create an API key."}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          variant="outline"
          type="button"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          loading={busy}
          disabled={busy || !canManage || !name.trim()}
        >
          <IconPlusOutline18 data-icon="inline-start" />
          Create API key
        </Button>
      </DialogFooter>
    </form>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy || (!next && credential && !saved)) return;
        if (next) {
          setSaved(false);
          setError("");
        }
        setOpen(next);
      }}
    >
      {credential && saved ? (
        <p role="status" className="text-sm text-muted-foreground">
          API key ready.
        </p>
      ) : (
        <DialogTrigger
          disabled={!canManage}
          render={<Button variant="primary" disabled={!canManage} />}
        >
          <IconPlusOutline18 data-icon="inline-start" /> Create API key
        </DialogTrigger>
      )}
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!busy && !credential}
      >
        <DialogHeader>
          <DialogTitle>
            {credential ? "Your API key is ready" : "Create API key"}
          </DialogTitle>
          <DialogDescription>
            {credential
              ? "Your key works with the API and supported MCP clients."
              : "Name your key so you can identify its requests and usage."}
          </DialogDescription>
        </DialogHeader>
        {content}
        {credential && (
          <DialogFooter>
            <Button
              variant="primary"
              onClick={() => {
                setSaved(true);
                setName("");
                setOpen(false);
                onSaved?.();
              }}
            >
              I’ve saved my key
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

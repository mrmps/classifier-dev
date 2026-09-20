import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { ActionResult, AppAction, AppSnapshot } from "@/server/contracts";
import { ApiKeyCreator, type CreatedApiKey } from "./api-key-creator";

type Props = {
  snapshot: AppSnapshot;
  act: (action: AppAction) => Promise<ActionResult>;
  onSelect?: (id: string) => void;
};
/** Secrets are fetched on explicit reveal, kept only in component memory. */
export function KeyAccess({ snapshot, act, onSelect }: Props) {
  const keys = snapshot.keys.filter((key) => key.status !== "revoked");
  const [selected, setSelected] = useState("");
  const key =
    keys.find((key) => key.id === selected) ||
    keys.find((key) => key.name === "Default") ||
    keys[0];
  const [revealed, setRevealed] = useState<{
    id: string;
    prefix: string;
    secret: string;
  } | null>(null);
  const [newKey, setNewKey] = useState<CreatedApiKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canManage =
    snapshot.organizations?.active.role === "owner" ||
    snapshot.organizations?.active.role === "admin";
  useEffect(() => {
    if (key) onSelect?.(key.id);
  }, [key?.id, onSelect]);
  const secret =
    revealed && key && revealed.id === key.id && revealed.prefix === key.prefix
      ? revealed.secret
      : "";
  async function reveal(copy: boolean) {
    if (!key) return;
    setBusy(true);
    setError("");
    try {
      const result = await act({ type: "reveal-key", keyId: key.id });
      if (!result.secret) throw new Error("No key was returned.");
      if (!copy)
        setRevealed({ id: key.id, prefix: key.prefix, secret: result.secret });
      if (copy) {
        await navigator.clipboard.writeText(result.secret);
        setError("Copied to clipboard.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reveal the key.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {key ? (
        <>
          <Select
            value={key.id}
            onValueChange={(id) => {
              setSelected(String(id));
              setRevealed(null);
              setError("");
            }}
          >
            <SelectTrigger className="w-full max-w-64" aria-label="API key">
              <SelectValue>{key.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {keys.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                  {item.status === "paused" ? " (paused)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all text-xs leading-6">
              {secret || `${key.prefix}••••••••`}
            </code>
            {canManage &&
              (secret ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRevealed(null)}
                  >
                    Hide
                  </Button>
                  <CopyButton value={secret} label="Copy key" />
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || key.recoverable === false}
                    onClick={() => void reveal(false)}
                  >
                    Show
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || key.recoverable === false}
                    onClick={() => void reveal(true)}
                  >
                    Copy key
                  </Button>
                </>
              ))}
          </div>
          {key.status === "paused" && (
            <p className="text-xs text-muted-foreground">
              This key is paused. Resume it in API keys before making a request.
            </p>
          )}
          {key.recoverable === false && (
            <p className="text-xs text-muted-foreground">
              This older key can’t be revealed. Use your saved copy or rotate it
              in API keys.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No active keys. Create a key to get started.
        </p>
      )}
      {!canManage ? (
        <p className="text-xs text-muted-foreground">
          Ask an owner or admin for API access.
        </p>
      ) : (
        <ApiKeyCreator
          credential={newKey}
          canManage={canManage}
          act={act}
          onCreated={(created) => {
            setNewKey(created);
            setSelected(created.id);
          }}
          onSaved={() => setNewKey(null)}
        />
      )}
      {error && (
        <p role="status" className="text-xs text-muted-foreground">
          {error}
        </p>
      )}
    </div>
  );
}

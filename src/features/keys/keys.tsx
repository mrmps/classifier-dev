import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { CopyButton } from "@/components/ui/copy-button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { formatCreditsUsd } from "@/lib/billing";
import { useState, type ReactNode } from "react";
import { ApiKeyCreator, type CreatedApiKey } from "./api-key-creator";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ArrowUpRight,
  ChevronDown,
  Ban,
  KeyIcon,
  Lock,
  Play,
  Search,
} from "@/components/ui/icons";
import type { AppSnapshot, AppAction, ActionResult } from "@/server/contracts";

type Key = AppSnapshot["keys"][number];
const date = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function Keys({
  snapshot,
  act,
  embedded = false,
}: {
  snapshot: AppSnapshot;
  act: (action: AppAction) => Promise<ActionResult>;
  embedded?: boolean;
}) {
  const canManage =
    snapshot.organizations?.active.role === "owner" ||
    snapshot.organizations?.active.role === "admin";
  const [managing, setManaging] = useState<{
    key: Key;
    mode: "reveal" | "rename" | "rotate";
  } | null>(null);
  const [keyName, setKeyName] = useState("");
  const [secret, setSecret] = useState("");
  const [keyError, setKeyError] = useState("");
  function manage(key: Key, mode: "reveal" | "rename" | "rotate") {
    setManaging({ key, mode });
    setKeyName(key.name);
    setSecret("");
    setKeyError("");
  }
  async function manageKey() {
    if (!managing || !canManage || busy) return;
    setBusy(true);
    setKeyError("");
    try {
      const result = await act(
        managing.mode === "rename"
          ? { type: "rename-key", keyId: managing.key.id, name: keyName }
          : managing.mode === "rotate"
            ? {
                type: "rotate-key",
                keyId: managing.key.id,
                prefix: managing.key.prefix,
              }
            : { type: "reveal-key", keyId: managing.key.id },
      );
      if (managing.mode === "rename") setManaging(null);
      else setSecret(result.secret || "");
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : "Could not update the key.");
    } finally {
      setBusy(false);
    }
  }
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<CreatedApiKey | null>(null);
  const [creationRound, setCreationRound] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("current");
  const [revoking, setRevoking] = useState<Key | null>(null);
  const apiKeys = snapshot.keys;
  const current = apiKeys.filter((key) => key.status !== "revoked");
  const revoked = apiKeys.filter((key) => key.status === "revoked");
  const keys = (filter === "current" ? current : revoked).filter((key) =>
    `${key.name} ${key.prefix} ${snapshot.agents.find((agent) => agent.id === key.id)?.client || ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const agents = new Map(snapshot.agents.map((agent) => [agent.id, agent]));

  async function update(action: AppAction) {
    if (!canManage) return;
    setBusy(true);
    try {
      await act(action);
      setRevoking(null);
    } catch {
      /* Keep the dialog open so the action can be retried. */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <KeysHeader
        embedded={embedded}
        title="API keys"
        description="Manage access and track usage for every app and agent."
        action={
          <ApiKeyCreator
            key={creationRound}
            credential={newKey}
            canManage={canManage}
            act={act}
            onCreated={setNewKey}
            onSaved={() => {
              setNewKey(null);
              setCreationRound((round) => round + 1);
              setFilter("current");
              setQuery("");
            }}
          />
        }
      />

      {!canManage && (
        <p id="keys-read-only" className="text-sm text-muted-foreground">
          You have read-only access. Ask a workspace owner or admin to create
          keys or change their access.
        </p>
      )}
      <section className="flex flex-col gap-4" aria-label="Your API keys">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ToggleGroup
            value={[filter]}
            onValueChange={(values) => {
              if (values[0]) setFilter(values[0]);
            }}
            aria-label="Filter API keys"
            size="sm"
          >
            <ToggleGroupItem value="current">
              Current{" "}
              <span className="text-muted-foreground tabular-nums">
                {current.length}
              </span>
            </ToggleGroupItem>
            <ToggleGroupItem value="revoked">
              Revoked{" "}
              <span className="text-muted-foreground tabular-nums">
                {revoked.length}
              </span>
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="relative w-full sm:w-60">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search API keys"
              placeholder="Search keys…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        {keys.length ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <Table
              aria-label="API keys and usage"
              className="min-w-[900px] table-fixed"
            >
              <TableHeader>
                <TableRow className="bg-muted/20 [&>th]:px-4 [&>th]:h-11">
                  <TableHead>Name</TableHead>
                  <TableHead className="w-52">Key prefix</TableHead>
                  <TableHead className="w-40 text-right">
                    Usage this period
                  </TableHead>
                  <TableHead className="w-28">Created</TableHead>
                  <TableHead className="w-28">Last used</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => {
                  const agent = agents.get(key.id);
                  return (
                    <TableRow
                      key={key.id}
                      className="hover:bg-muted/20 focus-within:bg-muted/20 [&>td]:h-14 [&>td]:px-4 [&>td]:py-3"
                    >
                      <TableCell>
                        <span
                          className="block truncate font-medium"
                          title={key.name}
                        >
                          {key.name}
                        </span>
                      </TableCell>
                      <TableCell>
                        <code
                          className="inline-flex items-center rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground"
                          title={`${key.prefix}••••`}
                          aria-label={`Key prefix ${key.prefix}. Remaining characters hidden.`}
                        >
                          {key.prefix.length > 20
                            ? `${key.prefix.slice(0, 11)}…${key.prefix.slice(-6)}`
                            : key.prefix}
                          <span aria-hidden="true">••••</span>
                        </code>
                      </TableCell>
                      <TableCell className="text-right">
                        {agent ? (
                          <span
                            className="tabular-nums"
                            title="Completed usage plus pending reservations this period"
                          >
                            {formatCreditsUsd(agent.used)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <time
                          dateTime={key.createdAt}
                          title={new Date(key.createdAt).toUTCString()}
                        >
                          {date(key.createdAt)}
                        </time>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {agent?.lastUsed ? (
                          <time
                            dateTime={agent.lastUsed}
                            title={new Date(agent.lastUsed).toUTCString()}
                          >
                            {date(agent.lastUsed)}
                          </time>
                        ) : (
                          "Never used"
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {key.status === "connected"
                            ? "Active"
                            : key.status === "pending"
                              ? "Unused"
                              : key.status === "paused"
                                ? "Paused"
                                : "Revoked"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {key.status !== "revoked" && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              disabled={busy || !canManage}
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Manage ${key.name}`}
                                  disabled={busy || !canManage}
                                  aria-describedby={
                                    !canManage ? "keys-read-only" : undefined
                                  }
                                />
                              }
                            >
                              <ChevronDown />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuGroup>
                                <DropdownMenuItem
                                  disabled={key.recoverable === false}
                                  onClick={() => manage(key, "reveal")}
                                >
                                  Show / copy key
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => manage(key, "rename")}
                                >
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  render={
                                    <a
                                      href={`/app/usage?key=${encodeURIComponent(key.id)}`}
                                    />
                                  }
                                >
                                  View usage
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => manage(key, "rotate")}
                                >
                                  Rotate key…
                                </DropdownMenuItem>
                                {agent && (
                                  <DropdownMenuItem
                                    disabled={busy || !canManage}
                                    onClick={() =>
                                      void update({
                                        type:
                                          key.status === "paused"
                                            ? "resume"
                                            : "pause",
                                        agentId: key.id,
                                      })
                                    }
                                  >
                                    {key.status === "paused" ? (
                                      <Play />
                                    ) : (
                                      <Ban />
                                    )}
                                    {key.status === "paused"
                                      ? "Resume key"
                                      : "Pause key"}
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => setRevoking(key)}
                                >
                                  <Ban />
                                  Revoke key
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Empty className="min-h-64 rounded-xl border border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {query ? <Search /> : <KeyIcon />}
              </EmptyMedia>
              <EmptyTitle>
                {query
                  ? "No matching keys"
                  : filter === "revoked"
                    ? "No revoked keys"
                    : canManage
                      ? "Create your first API key"
                      : "No API keys yet"}
              </EmptyTitle>
              <EmptyDescription>
                {query
                  ? "Try another name or key prefix."
                  : filter === "revoked"
                    ? "Keys you revoke will appear here for your records."
                    : "Create an API key above, then use it in your app or agent."}
              </EmptyDescription>
            </EmptyHeader>
            {query ? (
              <Button variant="outline" onClick={() => setQuery("")}>
                Clear search
              </Button>
            ) : null}
          </Empty>
        )}
      </section>
      <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
        <p className="flex max-w-lg items-start gap-2">
          <Lock className="mt-0.5 size-4 shrink-0" />
          Owners and admins can reveal active keys. Store keys in environment
          variables and keep them out of browser code.
        </p>
        <Button
          variant="ghost"
          size="sm"
          render={<a href="/docs" target="_blank" rel="noreferrer" />}
        >
          API documentation
          <ArrowUpRight data-icon="inline-end" />
        </Button>
      </div>

      <Dialog
        open={!!managing}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setManaging(null);
            setSecret("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {managing?.mode === "rename"
                ? "Rename API key"
                : managing?.mode === "rotate"
                  ? secret
                    ? "Key rotated"
                    : "Rotate API key?"
                  : "API key"}
            </DialogTitle>
            <DialogDescription>
              {managing?.mode === "rotate"
                ? "The old key will stop working. Update every app and agent using it. Usage history is preserved."
                : "This key authorizes API and MCP requests in your workspace."}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm font-medium">{managing?.key.name}</p>
          {managing?.mode === "rename" ? (
            <Input
              aria-label="Key name"
              value={keyName}
              maxLength={80}
              onChange={(e) => setKeyName(e.target.value)}
            />
          ) : secret ? (
            <div className="flex flex-col gap-3">
              <code className="break-all select-all text-xs leading-6">
                {secret}
              </code>
              <CopyButton value={secret} label="Copy key" />
            </div>
          ) : (
            <code className="text-xs">{managing?.key.prefix}••••••</code>
          )}
          {keyError && (
            <p role="alert" className="text-sm text-destructive">
              {keyError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setManaging(null);
                setSecret("");
              }}
            >
              {secret ? "Done" : "Cancel"}
            </Button>
            {!secret && (
              <Button
                variant="primary"
                loading={busy}
                disabled={
                  busy || (managing?.mode === "rename" && !keyName.trim())
                }
                onClick={() => void manageKey()}
              >
                {managing?.mode === "rename"
                  ? "Save name"
                  : managing?.mode === "rotate"
                    ? "Rotate key"
                    : "Reveal key"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!revoking}
        onOpenChange={(open) => {
          if (!open && !busy) setRevoking(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
            <AlertDialogDescription>
              New requests using this key will be blocked. Requests already
              running may finish. Revocation cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-1 rounded-lg bg-muted p-3">
            <p className="break-words font-medium">{revoking?.name}</p>
            <code className="text-xs text-muted-foreground">
              {revoking?.prefix}••••
            </code>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              variant="outline"
              disabled={busy}
              onClick={() => setRevoking(null)}
            >
              Keep key
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy || !canManage}
              onClick={() =>
                revoking &&
                void update({ type: "revoke-key", keyId: revoking.id })
              }
            >
              {busy ? "Revoking…" : "Revoke key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KeysHeader({
  embedded,
  title,
  description,
  action,
}: {
  embedded: boolean;
  title: string;
  description: string;
  action: ReactNode;
}) {
  return embedded ? (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  ) : (
    <PageHeader title={title} description={description} action={action} />
  );
}

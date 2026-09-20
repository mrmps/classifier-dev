import { formatCreditsUsd } from "@/lib/billing";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { PageHeader } from "@/components/page-header";
import { Fragment, useState } from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { AgentSetup } from "./agent-setup";
import type {
  AppSnapshot,
  AppAction,
  ActionResult,
} from "../../server/contracts";
import { Button } from "../../components/ui/button";
export function AgentList({
  snapshot,
  act,
  initialTask,
  embedded = false,
}: {
  snapshot: AppSnapshot;
  act: (action: AppAction) => Promise<ActionResult>;
  initialTask: string;
  embedded?: boolean;
}) {
  const canManage =
    snapshot.organizations?.active.role === "owner" ||
    snapshot.organizations?.active.role === "admin";
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showDisconnected, setShowDisconnected] = useState(false);
  const connections = snapshot.agents.filter((agent) => agent.client !== "API");
  const disconnectedCount = connections.filter(
    (agent) => agent.status === "revoked",
  ).length;
  const visibleConnections = connections.filter(
    (agent) => showDisconnected || agent.status !== "revoked",
  );
  async function action(value: AppAction) {
    if (!canManage || busy) return;
    setBusy(true);
    try {
      await act(value);
      setConfirm("");
    } catch {
      /* Shared action handler displays the error toast. */
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-8">
      {!embedded && (
        <PageHeader
          title="Agent connections"
          description="Connect an agent and manage its access."
        />
      )}
      {!embedded && (
        <Button
          className="self-start"
          disabled={!canManage}
          onClick={() => setShowSetup(!showSetup)}
        >
          {showSetup ? "Close setup" : "Add agent"}
        </Button>
      )}
      {!canManage && (
        <p id="agents-read-only" className="text-sm text-muted-foreground">
          You have read-only access. Ask a workspace owner or admin to connect
          agents or change their access.
        </p>
      )}
      {showSetup && (
        <AgentSetup snapshot={snapshot} act={act} initialTask={initialTask} />
      )}
      <section aria-label="Agent connections">
        {!visibleConnections.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No active connections</EmptyTitle>
              <EmptyDescription>
                Connect Claude Code, Codex, Cursor, or another client to get
                started.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <Table
              aria-label="Agent connections and usage"
              className="min-w-[760px] [&_th]:px-4 [&_td]:px-4 [&_td]:py-4"
            >
              <TableHeader className="border-b border-border bg-muted/40 [&_th]:h-11 [&_th]:text-xs [&_th]:text-muted-foreground">
                <TableRow>
                  <TableHead>Name / client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Used this period</TableHead>
                  <TableHead>Last used (UTC)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:not(:last-child)]:border-b [&_tr]:border-border/70">
                {[...visibleConnections]
                  .sort(
                    (a, b) =>
                      Number(a.status === "revoked") -
                      Number(b.status === "revoked"),
                  )
                  .map((agent) => (
                    <Fragment key={agent.id}>
                      <TableRow>
                        <TableCell>
                          <p className="font-medium">{agent.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {agent.client}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {agent.status === "connected"
                              ? "Verified"
                              : agent.status === "revoked"
                                ? "Disconnected"
                                : agent.status === "pending"
                                  ? "Awaiting first request"
                                  : "Paused"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCreditsUsd(agent.used)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {agent.lastUsed ? (
                            <time dateTime={agent.lastUsed}>
                              {new Date(agent.lastUsed).toLocaleString(
                                "en-US",
                                {
                                  timeZone: "UTC",
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                },
                              )}
                            </time>
                          ) : (
                            "Not yet"
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            {agent.status !== "revoked" &&
                              confirm !== agent.id && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy || !canManage}
                                    onClick={() =>
                                      void action({
                                        type:
                                          agent.status === "paused"
                                            ? "resume"
                                            : "pause",
                                        agentId: agent.id,
                                      })
                                    }
                                  >
                                    {agent.status === "paused"
                                      ? "Resume"
                                      : "Pause"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy || !canManage}
                                    onClick={() => setConfirm(agent.id)}
                                  >
                                    Disconnect
                                  </Button>
                                </>
                              )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {confirm === agent.id && (
                        <TableRow>
                          <TableCell colSpan={5}>
                            <Alert>
                              <AlertTitle>Disconnect {agent.name}?</AlertTitle>
                              <AlertDescription>
                                New requests will be blocked. Requests already
                                running may finish. Create a new connection to
                                restore access.
                              </AlertDescription>
                              <div className="mt-3 flex gap-2">
                                <Button
                                  variant="destructive"
                                  disabled={busy || !canManage}
                                  onClick={() =>
                                    void action({
                                      type: "revoke",
                                      agentId: agent.id,
                                    })
                                  }
                                >
                                  Disconnect agent
                                </Button>
                                <Button
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => setConfirm("")}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </Alert>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
      {disconnectedCount > 0 && (
        <Button
          variant="ghost"
          className="self-start"
          onClick={() => setShowDisconnected(!showDisconnected)}
        >
          {showDisconnected
            ? "Hide disconnected agents"
            : `Show disconnected agents (${disconnectedCount})`}
        </Button>
      )}
      <p className="text-sm text-muted-foreground">
        Connections share your workspace balance. Usage includes pending
        reservations.
      </p>
    </div>
  );
}

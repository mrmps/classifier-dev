import { useState } from "react";
import type {
  OrganizationContext,
  OrganizationRole,
} from "@/server/organization-contracts";
import type { OrganizationActionHandler } from "./workspace-switcher";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, ChevronDown, Users } from "@/components/ui/icons";

export function Team({
  context,
  seatLimit,
  onAction,
  navigate,
}: {
  context: OrganizationContext;
  seatLimit: number | null;
  onAction: OrganizationActionHandler;
  navigate: (path: string) => void;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<
    OrganizationContext["members"][number] | null
  >(null);
  const usedSeats = context.members.length + context.invitations.length;
  const full = seatLimit !== null && usedSeats >= seatLimit;
  const canManage =
    context.mode === "demo" &&
    context.active.kind === "organization" &&
    context.active.role !== "member";
  async function run(action: Parameters<OrganizationActionHandler>[0]) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onAction(action);
      setInviteOpen(false);
      setRemoving(null);
      setEmail("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update the team.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Team"
        description="The people in your organization and what they can manage."
        action={
          context.active.kind === "organization" &&
          <Button
            disabled={!canManage || busy}
            onClick={() => {
              if (full) navigate("/app/plans");
              else {
                setError("");
                setInviteOpen(true);
              }
            }}
          >
            <Plus data-icon="inline-start" />
            {full ? "View plans" : "Prepare invitation"}
          </Button>
        }
      />
      {context.active.kind === "personal" && (
        <p className="text-sm text-muted-foreground">
          Create an organization from the workspace switcher to share access
          with your team.
        </p>
      )}
      {context.active.kind === "organization" && !canManage && (
        <p className="text-sm text-muted-foreground">
          {context.mode !== "demo"
            ? "Team changes are not available in this workspace yet."
            : "An owner or admin can manage invitations. Ask them to add a teammate."}
        </p>
      )}
      {canManage && full && (
        <p className="text-sm text-muted-foreground">
          All {seatLimit} seats are in use, including prepared invitations. Cancel
          an unused invitation or upgrade to a plan with more seats.
        </p>
      )}
      <section
        className="overflow-hidden rounded-xl border border-border"
        aria-label="Team members"
      >
        <div className="flex items-center gap-2 px-5 py-4">
          <Users size={17} className="text-muted-foreground" />
          <h2 className="text-sm font-medium">Members</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="pr-5">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {context.members.map((member) => (
              <TableRow key={member.accountId}>
                <TableCell className="py-5 pl-5">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">
                      {member.name}
                      {member.accountId === context.identity.id && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          You
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {member.email}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="capitalize">{member.role}</TableCell>
                <TableCell className="text-muted-foreground">
                  {member.role === "owner"
                    ? "Full access"
                    : member.role === "admin"
                      ? "Manage workspace"
                      : "View only"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {new Date(member.joinedAt).toLocaleDateString("en-US", {
                    timeZone: "UTC",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </TableCell>
                <TableCell className="pr-5 text-right">
                  {canManage &&
                    member.accountId !== context.identity.id &&
                    context.active.role === "owner" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="sm" />}
                          disabled={busy}
                          aria-label={`Manage ${member.name}`}
                        >
                          Manage
                          <ChevronDown data-icon="inline-end" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuGroup>
                            {(
                              ["owner", "admin", "member"] as OrganizationRole[]
                            )
                              .filter(
                                (value) =>
                                  context.active.role === "owner" &&
                                  value !== member.role,
                              )
                              .map((value) => (
                                <DropdownMenuItem
                                  key={value}
                                  onClick={() =>
                                    void run({
                                      type: "set-role",
                                      accountId: member.accountId,
                                      role: value,
                                    })
                                  }
                                >
                                  Make {value}
                                </DropdownMenuItem>
                              ))}
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => {
                                setError("");
                                setRemoving(member);
                              }}
                            >
                              Remove member
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 text-xs text-muted-foreground">
          <span>
            {context.members.length}{" "}
            {context.members.length === 1 ? "member" : "members"}
          </span>
          <span>
            {seatLimit === null
              ? `${usedSeats} seats used · unlimited available`
              : `${usedSeats} / ${seatLimit} seats used`}
            {context.invitations.length > 0
              ? " · includes prepared invitations"
              : ""}
          </span>
        </div>
      </section>
      {context.invitations.length > 0 && (
        <section
          className="flex flex-col gap-4"
          aria-label="Prepared invitations"
        >
          <div>
            <h2 className="text-base font-medium">Prepared invitations</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Saved locally. No email has been sent and access has not been
              granted.
            </p>
          </div>
          <div className="rounded-xl border border-border p-2">
            {context.invitations.map((invite) => (
              <div
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm">{invite.email}</span>
                  <span className="text-xs capitalize text-muted-foreground">
                    {invite.role}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">Prepared</Badge>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={`Cancel invitation for ${invite.email}`}
                      onClick={() =>
                        void run({
                          type: "revoke-invite",
                          invitationId: invite.id,
                        })
                      }
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {error && !inviteOpen && !removing && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={inviteOpen}
        onOpenChange={(value) => {
          if (!busy) setInviteOpen(value);
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Prepare an invitation</DialogTitle>
            <DialogDescription>
              Prepare an invitation for {context.active.name}.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void run({ type: "invite", email: email.trim(), role });
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="invite-email">Email address</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  autoComplete="email"
                  placeholder="teammate@company.com"
                  value={email}
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="invite-role">Role</FieldLabel>
                <Select
                  disabled={busy}
                  value={role}
                  items={[
                    { value: "member", label: "Member" },
                    { value: "admin", label: "Admin" },
                  ]}
                  onValueChange={(value) => {
                    if (value === "admin" || value === "member") setRole(value);
                  }}
                >
                  <SelectTrigger
                    id="invite-role"
                    aria-describedby="invite-role-description"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription id="invite-role-description">
                  {role === "admin"
                    ? "Can manage keys, agents, settings, and invitations. Only owners can manage billing and member roles."
                    : "Can view the workspace, usage, and billing. Cannot change settings or credentials."}
                </FieldDescription>
              </Field>
            </FieldGroup>
            <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
              Local demo: this saves a prepared invitation. Email delivery and
              accepting invitations are not connected yet.
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setInviteOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !email.trim()}>
                {busy ? "Preparing…" : "Prepare invitation"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!removing}
        onOpenChange={(value) => {
          if (!value && !busy) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will lose access to this organization. Shared API keys stay
              active; rotate any keys shared with this person.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep member</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (removing)
                  void run({
                    type: "remove-member",
                    accountId: removing.accountId,
                  });
              }}
            >
              {busy ? "Removing…" : "Remove member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

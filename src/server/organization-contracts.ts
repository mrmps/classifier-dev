/** Browser-safe workspace identity and membership contracts. */
export type OrganizationRole = "owner" | "admin" | "member";
export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: "personal" | "organization";
  role: OrganizationRole;
}
export interface OrganizationContext {
  identity: { id: string; name: string; email: string };
  active: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  members: Array<{
    accountId: string;
    name: string;
    email: string;
    role: OrganizationRole;
    joinedAt: string;
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: "admin" | "member";
    createdAt: string;
    status: "prepared";
  }>;
  mode: "unconfigured";
}
export type OrganizationAction =
  | { type: "create"; name: string }
  | { type: "switch"; workspaceId: string }
  | { type: "rename"; name: string }
  | { type: "invite"; email: string; role: "admin" | "member" }
  | { type: "revoke-invite"; invitationId: string }
  | { type: "set-role"; accountId: string; role: OrganizationRole }
  | { type: "remove-member"; accountId: string };

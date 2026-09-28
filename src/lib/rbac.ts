import type { Role } from "@/lib/types";

/** Developers: read-only dashboard. DevOps/Admin: dashboard + kill-command reveal + machine/user admin. */
export const CAN_VIEW_DASHBOARD: Role[] = ["DEVELOPER", "DEVOPS", "ADMIN"];
export const CAN_REVEAL_KILL_COMMAND: Role[] = ["DEVOPS", "ADMIN"];
export const CAN_MANAGE_CONNECTIONS: Role[] = ["DEVOPS", "ADMIN"];
/** Creating/inviting/disabling accounts and resetting someone else's MFA — Admin only, deliberately narrower than DB Machines. */
export const CAN_MANAGE_USERS: Role[] = ["ADMIN"];

export function roleAllows(role: Role, allowed: Role[]): boolean {
  return allowed.includes(role);
}

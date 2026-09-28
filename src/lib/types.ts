/**
 * App roles. Stored as a plain string column in the DB (see prisma/schema.prisma
 * for why) but treated as this closed union everywhere in app code.
 */
export type Role = "DEVELOPER" | "DEVOPS" | "ADMIN";

export const ROLES: Role[] = ["DEVELOPER", "DEVOPS", "ADMIN"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

/**
 * INVITED: admin created the account, invite email sent, no password set
 * yet — cannot log in until the invite is accepted.
 * ACTIVE: normal, can log in (subject to MFA setup/verify — see
 * src/lib/mfa.ts).
 * DISABLED: blocked at login regardless of password (offboarding). Not
 * automatically re-enabled by anything — an admin has to flip it back.
 */
export type UserStatus = "INVITED" | "ACTIVE" | "DISABLED";

export const USER_STATUSES: UserStatus[] = ["INVITED", "ACTIVE", "DISABLED"];

export function isUserStatus(value: unknown): value is UserStatus {
  return typeof value === "string" && (USER_STATUSES as string[]).includes(value);
}

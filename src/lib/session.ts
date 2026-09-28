import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "@/lib/types";

export const SESSION_COOKIE = "qm_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

export interface SessionPayload {
  sub: string; // user id
  email: string;
  role: Role;
}

function getSecretKey(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw) {
    throw new Error("SESSION_SECRET is not set. Generate one with `openssl rand -base64 32`.");
  }
  return new TextEncoder().encode(raw);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (!payload.sub || !payload.email || !payload.role) return null;
    return { sub: payload.sub as string, email: payload.email as string, role: payload.role as Role };
  } catch {
    return null;
  }
}

/** Reads and verifies the session cookie for the current request (Server Components / Route Handlers). */
export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function setSessionCookie(token: string) {
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie() {
  cookies().delete(SESSION_COOKIE);
}

// ---------------------------------------------------------------------------
// Pending-auth cookie: a short-lived, narrower token used for the gap
// between "password checked out" and "MFA satisfied" — either verifying a
// code (an existing MFA-enabled account logging in) or setting MFA up for
// the first time (a brand-new invited user, or any pre-existing account
// that doesn't have MFA enabled yet). Deliberately a DIFFERENT cookie/shape
// from the real session token so a pending token can never be mistaken for
// (or used as) a logged-in session — see verifySessionToken, which requires
// an email/role this token never carries.
// ---------------------------------------------------------------------------

export const PENDING_COOKIE = "qm_pending";
const PENDING_TTL_SECONDS = 60 * 15; // 15 minutes — long enough to find your phone, short enough not to linger

export type PendingPurpose = "MFA_VERIFY" | "MFA_SETUP";

export interface PendingPayload {
  sub: string; // user id
  purpose: PendingPurpose;
}

export async function createPendingToken(payload: PendingPayload): Promise<string> {
  return new SignJWT({ purpose: payload.purpose, typ: "pending" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${PENDING_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifyPendingToken(token: string): Promise<PendingPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (payload.typ !== "pending" || !payload.sub || !payload.purpose) return null;
    return { sub: payload.sub as string, purpose: payload.purpose as PendingPurpose };
  } catch {
    return null;
  }
}

export async function setPendingCookie(token: string) {
  cookies().set(PENDING_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_TTL_SECONDS,
  });
}

export async function getPendingSession(purpose: PendingPurpose): Promise<PendingPayload | null> {
  const token = cookies().get(PENDING_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyPendingToken(token);
  if (!payload || payload.purpose !== purpose) return null;
  return payload;
}

export function clearPendingCookie() {
  cookies().delete(PENDING_COOKIE);
}

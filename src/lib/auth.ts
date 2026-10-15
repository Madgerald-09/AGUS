import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, sessions, attempts } from "./db";
import { AppError } from "./domain";
import { config } from "./config";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function checkPassword(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  if (!salt || !key || !/^[a-f0-9]{128}$/.test(key)) return false;
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(key, "hex"));
}
export function sameOrigin(req: Request) {
  const expected = process.env.APP_ORIGIN ?? "http://localhost:3000";
  if (req.headers.get("origin") !== expected)
    throw new AppError("Request origin rejected", 403);
}
export async function login(password: string) {
  const d = await db();
  const key = "operator-login";
  const resetAt = new Date(Date.now() + 15 * 60000);
  const [a] = await d
    .insert(attempts)
    .values({ key, attempts: 1, resetAt })
    .onConflictDoUpdate({
      target: attempts.key,
      set: {
        attempts: sql`CASE WHEN ${attempts.resetAt} < now() THEN 1 ELSE ${attempts.attempts} + 1 END`,
        resetAt: sql`CASE WHEN ${attempts.resetAt} < now() THEN ${resetAt.toISOString()}::timestamptz ELSE ${attempts.resetAt} END`,
      },
    })
    .returning();
  if (a.attempts > 10)
    throw new AppError(
      "Too many login attempts. Try again in 15 minutes.",
      429,
    );
  const stored = process.env.OPERATOR_PASSWORD_HASH;
  if (!stored)
    throw new AppError(
      "Configure OPERATOR_PASSWORD_HASH using npm run operator:password",
      503,
    );
  if (!checkPassword(password, stored))
    throw new AppError("Invalid operator password", 401);
  await d.delete(attempts).where(eq(attempts.key, key));
  const token = randomBytes(32).toString("hex");
  await d
    .insert(sessions)
    .values({
      tokenHash: hash(token),
      operatorId: config().operator,
      expiresAt: new Date(Date.now() + 60 * 60000),
    });
  return token;
}
export function cookieToken(req: Request) {
  return (
    req.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("ha_session="))
      ?.slice(11) ?? ""
  );
}
export async function operator(req: Request) {
  const token = cookieToken(req);
  if (!token) throw new AppError("Sign in to continue", 401);
  const d = await db();
  const [session] = await d
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hash(token)));
  if (
    !session ||
    session.expiresAt.getTime() < Date.now() ||
    session.operatorId !== config().operator
  )
    throw new AppError("Session expired; sign in again", 401);
  return session.operatorId;
}
export async function logout(req: Request) {
  const d = await db();
  await d
    .delete(sessions)
    .where(eq(sessions.tokenHash, hash(cookieToken(req))));
}
export function sessionCookie(token: string) {
  return `ha_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 3600 : 0}${(process.env.APP_ORIGIN ?? "").startsWith("https://") ? "; Secure" : ""}`;
}

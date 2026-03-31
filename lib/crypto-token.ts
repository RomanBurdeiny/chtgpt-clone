import { createHash, randomBytes } from "crypto";

export function randomSecret(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

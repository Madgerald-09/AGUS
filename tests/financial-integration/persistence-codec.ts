import { z } from "zod";
// A test codec for the injected-schema storage boundary; no Agent B implementation.
export const TestContextSchema = z.strictObject({
  tenantId: z.string(),
  actorId: z.string(),
  conversationId: z.string(),
  schemaVersion: z.literal(1),
  revision: z.number().int().positive(),
  transcript: z.string(),
});

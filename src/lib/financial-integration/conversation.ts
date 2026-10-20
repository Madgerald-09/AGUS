import { z } from "zod";
import { IdSchema } from "../financial-data/contracts";
import {
  ContextSchema,
  createConfiguredModel,
  createFinancialAgent,
  createRepositoryAccess,
  type AgentModel,
} from "../financial-agent";
import { authorizedFinancialAccess } from "./access";
import { createContextPersistence } from "./context-persistence";
import { createDurableRepository } from "./storage";

export const ConversationInput = z.strictObject({
  conversationId: IdSchema,
  text: z.string().trim().min(1).max(4000),
  accountIds: z
    .array(IdSchema)
    .max(5)
    .refine((v) => new Set(v).size === v.length),
});

/** The HTTP route always uses the configured provider. Model injection is a
 * server-only test seam, never a request parameter or a fixture inference mode. */
export async function conversationTurn(
  req: Request,
  input: z.infer<typeof ConversationInput>,
  model: AgentModel = createConfiguredModel(),
) {
  const capability = await authorizedFinancialAccess(req);
  const clock = () => new Date().toISOString();
  return createFinancialAgent({
    model,
    tools: capability.tools,
    access: createRepositoryAccess(createDurableRepository(), clock),
    store: createContextPersistence(
      capability.context,
      ContextSchema.parse,
      clock,
      { renewExpired: true },
    ),
    clock,
  }).turn({
    ...ConversationInput.parse(input),
    ctx: capability.context,
    // Requested IDs confer no permission. B checks ownership, consent and source
    // revisions before planning/reads; education never resolves account grants.
  });
}

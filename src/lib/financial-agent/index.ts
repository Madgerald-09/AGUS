/** Server-side isolated Agent B module. No routes, payment mutations or implicit singleton state. */
export {
  createFinancialAgent,
  LIMITS,
  type AgentOptions,
  type AgentReply,
} from "./agent";
export { createConfiguredModel } from "./model";
export {
  createRepositoryAccess,
  type AccessResolver,
  type AccessSnapshot,
} from "./access";
export {
  MemoryContextStore,
  ContextSchema,
  ContextKeySchema,
  type ContextStore,
  type ConversationContext,
  type ContextKey,
} from "./context";
export {
  DecisionSchema,
  RouteSchema,
  AgentError,
  type AgentModel,
  type ModelTask,
} from "./protocol";
export { PRODUCT_KNOWLEDGE } from "./knowledge";

import type { ReadToolDispatcher } from "../financial-data/contracts";
import { financialContext, financialDispatcher } from "./service";
import { createDurableRepository } from "./storage";
import { createContextStore } from "./context-store";

/** Per-request capability bundle for the future orchestration composition root. */
export async function authorizedFinancialAccess(req: Request) {
  const context = Object.freeze(await financialContext(req));
  const runtime = financialDispatcher();
  // Preserve A's dispatcher interface while binding every call to this session.
  // The caller's context argument cannot change identity, clock or request scope.
  const tools: ReadToolDispatcher = {
    execute: (_callerContext, call) => runtime.execute(context, call),
    dispatch: (_callerContext, call) => runtime.dispatch(context, call),
  };
  return {
    context,
    tools: Object.freeze(tools),
    contextStore: createContextStore(context, createDurableRepository()),
  };
}

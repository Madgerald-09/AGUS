# Agent B — isolated AGUS Phase 2B handoff

Status: **isolated module for review; no routes/UI wired, no merge or deployment**.
Genuine inference is **BLOCKED**, not verified. Agent A's contract remains
**PROVISIONAL** until Gerald/the integration owner records approval.

## References and ownership

- Branch: `feat/agus-readonly-orchestration`.
- Isolated worktree: `/workspace/agus-readonly-orchestration`.
- Exact base: `a60206657c9a57f58479cc2e08679a907813fe5f`, PR #14's repaired implementation.
- Provisional dependency: `08fd872cdf666964ca6625b2b09bc4c7180c682a`.
  `git diff 08fd872 HEAD -- src/lib/financial-data/contracts.ts` is empty.
- Implementation: `d79b077568906cbe86f9480ebd07687fca9d4af1`.
- Final runtime/context repair: `38316bd1bf8e2523545968b7324fad5e9124caf7`.
  Later handoff commits change documentation only.
- Reviewed PRs [#13](https://github.com/omnmlr/hackaholics-financial-agent/pull/13)
  and [#14](https://github.com/omnmlr/hackaholics-financial-agent/pull/14), their
  discussions (none returned), `WORKSTREAMS.md`, `ARCHITECTURE_CONTRACTS.md`,
  Agent A's handoff and the existing inference/configuration boundaries.

The user's Phase 2B goal authorizes this isolated implementation against the
provisional repaired contract. It does not constitute a contract-freeze record.
G0 cleanup, shared contract approval, authenticated integration, durable storage
and release review remain Gerald/founder responsibilities.

Only Agent B-owned paths change: `src/lib/financial-agent/**`,
`tests/financial-agent/**`, `scripts/verify-financial-model.ts`, this document and
`model-verification.md`. No payment/authentication code, existing routes, Agent A
files, dashboard/UI, migrations, configuration, dependencies or old tests change.
The draft PR is stacked on `feat/agus-financial-data` to show only Agent B's diff.

## Behavior and safety boundary

Classification uses the injected model and a strict route schema: general,
product, financial read, payment draft or payment action. Conservative server
checks supplement classification. Ordinary greetings, stories, emotional support
and explanations have a separate natural-language generation path; it receives
no tool results or selection metadata. An independent structured model review and
lexical/action checks reject financial, product, credential and action claims.
No financial model prose or model-written clarification is displayed. General
conversation quality and semantic model routing remain unverified on a genuine
provider because the model gate is blocked; scripted tests are regression evidence.

Product answers select a fixed entry in the code-local, immutable
`agus-product-v1.0.0` manifest, with source/version/review date. Unknown capabilities,
fees or guarantees have an explicit unknown entry. This is a small capability
manifest, not external retrieval or a user-editable knowledge base. All knowledge
files are under Agent B's ownership.

The financial planner uses Agent A's mapped `ToolCall` union and strict validators.
It can ask an approved clarification, call one of A's five reads, or reference
current-turn result IDs. The server creates one fact-catalogue entry per result;
there is no arbitrary fact-path traversal or unrestricted response string.
Every financial answer renders whole server templates with result ID, source/mode,
as-of time, coverage, truncation and simulation markers. Money uses exact integer
kobo formatting. Calculations come from A over all provider pages; search pages
are never summed. Filtered differences, groups, excluded statuses, returned funds,
unknown balances, partial coverage, missing evidence and empty searches retain
their limitations. A record/status never establishes recipient bank credit.

Descriptions, institution prose, references, provider errors, receipt limitations,
artifact metadata and raw provider bodies are withheld from planner context.
Counterparty labels are scrubbed, bounded and explicitly named untrusted data;
output labels/group keys are escaped literal fields inside server templates.
All input/history is untrusted, including previous model responses. URLs, long
account-like numbers and common credential forms are scrubbed before persistence
and model disclosure, including when stored history is loaded again. This scrubber
is not a general DLP guarantee: integration must keep credentials and raw bank
payloads outside these APIs and complete real-data model/retention reviews.

Payment preparation returns only `{ handoff: { kind: "existing_payment_draft" } }`.
It does not extract draft fields, call a callback or import payment modules. Gerald
must route the original request through the existing validated draft workflow.
Approval, submit, retries and OTP return a fixed instruction to use that workflow.
No model output can add tools, choose a principal or invoke payment execution.

## Exports and injected interfaces

Import server-side from `@/lib/financial-agent` (barrel) or the corresponding files.
No existing application singleton is imported or modified.

| Export                                                                       | Integration responsibility                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFinancialAgent(options).turn(input)`                                  | Inject model, read dispatcher, access resolver, scoped context store and trusted clock. Returns plain text, kind, citations, optional draft handoff and bounded counters/safe error code.            |
| `AgentOptions`, `AgentReply`                                                 | Typed seam for Gerald's new server route. Tool/model fakes in tests do not certify a live provider.                                                                                                  |
| `createConfiguredModel()`                                                    | Uses existing `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`; fixed OpenAI/Gemini endpoints, existing default model names, no provider switching or HTTP retries.                                           |
| `AgentModel`, `ModelTask`                                                    | One `generate(task, data, signal)` call equals one provider attempt. Custom adapters must honor abort and perform no implicit retries.                                                               |
| `createRepositoryAccess(repository, clock)`                                  | Server-side resolver using A's existing `FinancialRepository`: account ownership, consent state/time/source/mode, exact required scopes and revision fingerprint. No alternate transaction contract. |
| `AccessResolver`, `AccessSnapshot`                                           | Server-owned seam; stable principal/account/grant/source revision, expiry and authorized account IDs. Model/client must never supply it.                                                             |
| `ContextStore`, `ContextKey`, `ConversationContext`                          | Composite tenant/actor/conversation key, atomic load/CAS, versioned schema and candidates. Gerald supplies durable storage.                                                                          |
| `MemoryContextStore`                                                         | Injected process-local reference implementation; tests survive agent recreation using the same store. No database/process-restart durability claim.                                                  |
| `ContextSchema`, `ContextKeySchema`                                          | Validate loaded records and reject cross-scope/duplicate candidate metadata; reject stale CAS writes.                                                                                                |
| `DecisionSchema`, `RouteSchema`, `LIMITS`, `AgentError`, `PRODUCT_KNOWLEDGE` | Protocol, limits, safe failure codes and product manifest. No registry administration or payment exports.                                                                                            |

Example wiring in Gerald-owned integration code:

```ts
import {
  createFinancialAgent,
  createConfiguredModel,
  createRepositoryAccess,
} from "@/lib/financial-agent";

const clock = () => new Date().toISOString();
const agent = createFinancialAgent({
  model: createConfiguredModel(),
  tools: authorizedReadDispatcher,
  access: createRepositoryAccess(scopedRepository, clock),
  store: durableScopedCASStore,
  clock,
});

const reply = await agent.turn({
  ctx: principalFromAuthenticatedServerSession,
  conversationId: validatedConversationId,
  text: submittedText,
  accountIds: serverSelectedAuthorizedAccountIds,
});
// A handoff is an intent signal only. Existing draft verification, review,
// password approval, explicit submission and OTP stay in their existing paths.
```

`ctx`, account bindings and clock must be server-derived; the runtime input schema
alone is not authentication. Never accept a browser-submitted principal, resolver
or account grant. Render `reply.text` as text (not raw HTML), keep source markers,
and use the existing safe CSV encoder if exporting. There is no UI in this module.

## Budgets, follow-ups and failure behavior

- At most **5 sequential reads / 6 model calls / 60 seconds** for the entire turn,
  including context I/O, permissions and persistence. Each model attempt is at most
  20 seconds and each read/access check at most 10 seconds, clipped to remaining
  time. Fetch and response consumption share the attempt signal. Timers also race
  injected dependencies that ignore abort; late results are not disclosed.
- Raw validated tool output is capped at **16 KiB each / 48 KiB total**, before model
  disclosure. Oversized calculations fail; arithmetic is never silently truncated.
  Provider envelopes are bounded at 64 KiB. Repeated identical calls, duplicate
  call IDs/result IDs, unknown tools, extra keys and spoofed arguments fail closed.
  At the call limit only completed, rechecked server facts can be returned, with
  an explicit read-limit note. Transport/schema/access errors return unavailable.
- History is at most **16 scoped messages / 12 KiB**. Financial assistant prose is
  stored as a nonfactual placeholder, not reusable evidence. Candidate metadata is
  separate and bounded to 25 rows. No hidden reasoning is requested or persisted.
- Ambiguous search stops immediately and asks the user to choose, even when only
  one candidate is displayed. Saved candidate IDs, amounts, labels, revisions,
  filter, source result ID, access fingerprint and expiry survive agent recreation.
  Defaults expire after 15 minutes or earlier consent expiry.
- Before a follow-up, compare the current account/grant/source fingerprint; changed
  permissions, ingestion/revisions or expiry require a new search. Re-read chosen
  transaction details and compare revision before retrieving evidence. Never choose
  a first-ranked ambiguous row in the search turn. CAS conflicts disclose no answer.
- Recheck all used grants/scopes before/after each tool call, before/after subsequent
  model calls, before persistence and after persistence before returning facts.
  Permission failure suppresses every collected fact. A's dispatcher independently
  rechecks its own repository/provider permissions.
- Missing/ambiguous account, weekday or approximate amount asks a fixed clarification.
  No silent tolerance broadening. Multiple injected accounts need explicit scope.
  Search is intentionally a bounded candidate page: opaque continuation tokens are
  withheld and model cursor calls are rejected. Unshown candidates require refined
  search. Totals still use A's full-source calculator; no full-history search claim.

These are isolated service guarantees, not multi-user login, SQL durability,
provider connectivity or integrated route/auth guarantees. Real bank data and
model disclosure require the remaining identity, consent, retention/deletion and
model-data-policy gates; already-transmitted data cannot be recalled.

## Verification on the final runtime candidate

Runtime candidate: **`38316bd1bf8e2523545968b7324fad5e9124caf7`**.
Final check results are recorded below after execution. Temporary evidence files
are under `/tmp/agus-b-*`; they are not deployment artifacts.

| Check                                                          | Actual result                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Clean `npm ci --cache /tmp/agus-b-npm-cache`                   | PASS, 247 packages; dependency/lock files unchanged.                                                                                       |
| `npm test -- tests/financial-agent`                            | PASS, **85 tests / 4 files**.                                                                                                              |
| `npm test`                                                     | PASS, **436 tests / 21 files**, exit 0; `/tmp/agus-b-full-tests-38316bd.log` (56.88s).                                                     |
| `npm run typecheck`                                            | PASS.                                                                                                                                      |
| Scoped ESLint                                                  | PASS for new source, tests and verification script.                                                                                        |
| Scoped Prettier                                                | PASS; source, tests, verification script and both handoff documents.                                                                       |
| Production build and existing authenticated fixture HTTP smoke | PASS, exit 0 for both; `/tmp/agus-b-build-38316bd.log` and `/tmp/agus-b-http-38316bd.log`.                                                 |
| `npm run lint`                                                 | FAIL, exactly the same three tracked `.history` dashboard merge-marker parse errors at line 235. No exclusions/repairs in this workstream. |
| Genuine model smoke                                            | **BLOCKED**, exit 2, `MODEL_NOT_CONFIGURED`; provider `none`, model null, no HTTP inference attempted. See `model-verification.md`.        |
| Ownership, contract equality and diff checks                   | PASS; all 16 changed files are Agent B-owned, contract diff empty, generated Next.js type declarations restored.                           |

Meaningful focused coverage: varied natural general requests; product/unknown
knowledge; payment draft/actions; misclassification; real fixture all-page totals;
search/detail/evidence sequences; ambiguity with a truncated displayed candidate;
reload and amount-based selection; no results/evidence/balance; reversal links and
grouped/filtered totals; exact signed kobo; source validation; two principals;
missing scopes; expiry/revocation during tools, final inference and persistence;
stale source selections; hostile provider/model prose; spoofed tools/citations;
context poisoning/rescrubbing/CAS races; duplicate calls; call/byte/context/time
budgets; adapter completion/schema/HTTP/envelope failures without retries.

Earlier development failures are not passes: test harness assumptions about fixture
IDs and a nonexistent repository inspector were corrected; explicit environment
and call-ID types fixed typecheck failures (the first build caught them too).
Scoped lint found a control-character regex, unused imports and an unnecessary
escape; all were repaired in owned files. The first model-script attempt hit the
sandbox's `spawnSync git EPERM`; the script now emits a safe blocked result if Git
metadata is unavailable. The supported runtime permission allowed clean-SHA evidence.
The first shell fetch lacked proxy access; the supported network permission worked.
No failed assertion was weakened to claim success.

Browser suites are not rerun for this isolated server module. PR #13/#14's known
bank-retry browser failure is historical and remains outside Agent B ownership;
no current browser pass or release readiness is claimed. Full payment, persistence
and restart regression tests are included in the unit suite. The HTTP smoke uses
existing fixture routes and does not prove new module integration.

## Gerald's integration handoff

1. Review/record acceptance of provisional contract SHA `08fd872` and resolve G0's
   existing lint/browser defects. Keep this draft unmerged until review.
2. Integrate reviewed Agent A then B commits. Supply authenticated principal/account
   selection, trusted clock and approved durable composite-key context CAS storage.
   Do not reuse ownerless legacy messages or the global payment aggregate.
3. Wire the new read route and existing draft handoff in your owned seams. Preserve
   all existing mutation authorization and review controls. Do not execute payment
   callbacks from the read-tool registry.
4. Configure legitimate private model access using the intended existing provider/
   model and supported egress, then run the genuine verification script. Do not
   advertise connected conversation/tool reasoning until its scenarios actually pass.
5. Run integrated auth/origin/isolation/reload checks, complete unit/static/build/
   HTTP/browser checks and independent review on the integrated SHA. No automatic
   merge, deployment, live data or unrelated follow-on work is authorized here.

# Product knowledge selection repair

18 October 2026, WAT. Based on PR #19 at
`7f8d53dacb84c07cfa991009da5b384fec495ffc`; target branch
`integration/agus-phase2c-conversation`. Keep draft; do not merge or deploy.

## Cause and verification expectations

The reported genuine Gemini run reached `product` with a valid schema, then
returned `BLOCKED / SCENARIO_NOT_VERIFIED`. Earlier cases passed. This is a
scenario assertion failure, not a provider schema or transport failure.

The engine classifies first, then asks the model to select a product topic. A
`general` classification mentioning AGUS also falls back to `product`. The model
returns only a topic enum; `productAnswer` renders the corresponding reviewed
local entry and source attribution. The response kind establishes that the
product branch was reached; it does not establish which classifier route led
there.

At the base, the product selector received only `{ text }`, the enum and a rule
directing undocumented capabilities to `unknown`. It received none of the
reviewed entries. Yet the `data` entry already explicitly states:

> Wema and Mono account connections are not verified or supplied by this module.

This made selection of a documented negative capability answer depend on guessing
the contents of an unseen entry. The generic `unknown` answer is cautious but
does not answer the named integration question explicitly.

The unchanged verifier requires `kind === "product"`, attribution containing
`agus-product-v1.0.0`, and `fictional`. All topic renderings include the version;
only `data` includes `fictional`. Given the reported kind and failure, a topic
other than `data` was selected. The supplied evidence does not reveal the exact
topic, so `unknown` is a plausible selection, not a claimed observation. PR #19
has no posted provider trace or answer establishing more detail.

## Bounded change

The product selection request now includes the frozen, reviewed
`PRODUCT_KNOWLEDGE` manifest. The generic product rule directs the model to select
an entry that answers the question, including documented limitations and explicit
unverified capabilities, and to reserve `unknown` for questions no entry answers.
No bank names or question matching are added to routing or prompts.

The model still returns only a strict topic enum. All visible product prose still
comes from the existing local entries. Knowledge facts/version, acceptance
predicate, financial tools, permission/consent checks, payment boundaries and
general/education guards are unchanged. Product knowledge is supplied only for
the product task, with no account grants or financial tool results.

## Regression evidence

Node 24.19.0; clean dependency install using `npm ci` (247 packages).

- Before the repair: both changed test files ran, **6 failed / 40 passed**.
  Every failure identified missing knowledge in product selection input.
- After the repair:
  `npx vitest run tests/financial-agent tests/financial-integration/conversation.test.ts`
  — **111 passed / 6 files**, 6.69 seconds, exit 0.
- `npm run lint` — exit 0.
- `npm run typecheck` — exit 0.

Regression coverage includes the reported question, three integration paraphrases,
both direct product routing and the existing general-to-product fallback, explicit
Wema/Mono denial with attribution and fictional-data wording, no-account product
responses with zero financial tools, and manifest delivery through both OpenAI
and Gemini request formats. Existing unknown-capability and financial safeguard
tests also pass. Provider HTTP responses and topic choices in these unit tests
are explicitly scripted; they do not establish genuine inference quality.

No API keys are available in this task. No genuine inference was attempted or
verified here. No replacement transport, credential request or deployment was
introduced.

## Exact genuine Gemini rerun

Use an authorized runtime with the existing private `AI_API_KEY` configuration
and supported egress to `generativelanguage.googleapis.com`. Preserve normal
proxy and CA trust. Use Node 24.19.0 (or a compatible runtime supporting
`NODE_USE_ENV_PROXY`). Do not load fixture transport preloads or mocks.

```sh
git fetch origin fix/agus-product-integration-grounding
git switch fix/agus-product-integration-grounding
git pull --ff-only origin fix/agus-product-integration-grounding
npm ci
git rev-parse HEAD
git status --porcelain
AI_PROVIDER=gemini AI_MODEL=gemini-2.5-flash PAYMENT_MODE=fixture NODE_USE_ENV_PROXY=1 node --env-file-if-exists=.env.local --import tsx scripts/verify-financial-model.ts > /tmp/agus-product-gemini-verification.json
```

Run from a clean working tree at the repair PR's head. The private key may already
be injected by the authorized runtime or loaded from its private `.env.local`;
never put it in commands, source, chat or output. Use the original run's model if
it differed from `gemini-2.5-flash`, recording the actual model from the output.
Capture the command's exit status immediately and retain the sanitized JSON with
its commit, clean-tree status, provider/model, case outcomes and call counts.

Success requires exit **0**, top-level `PASS /
ALL_SYNTHETIC_SCENARIOS_VERIFIED`, and **all 12 cases PASS**, including `product`
and every subsequent financial, evidence, selection and payment-boundary case.
Do not stop at the repaired product case. Any failed case remains exit **2** /
`BLOCKED`; retain that evidence without relaxing assertions. The verifier uses
only synthetic fixture data and imports no payment engine. A passing run would
verify those synthetic model scenarios only, not live Wema/Mono integrations,
recipient credit, money movement or deployment.

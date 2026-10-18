# Agent B — genuine model verification

**MODEL-01: BLOCKED. No genuine inference or model-based interpretation was verified.**
The unit tests use labelled scripted models or mocked HTTP and do not satisfy this
gate. Runtime/provider/schema acceptance and conversational quality require a real
configured-model run after integration-owner setup.

## Actual evidence

Run on **18 October 2026, 01:30:48 WAT** (`2026-10-18T00:30:48.988Z`), from a clean
runtime candidate `38316bd1bf8e2523545968b7324fad5e9124caf7`:

```sh
node --import tsx scripts/verify-financial-model.ts
```

Exit **2**. Sanitized output (`/tmp/agus-b-model-final.json`):

```json
{
  "status": "BLOCKED",
  "at": "2026-10-18T00:30:48.988Z",
  "provider": "none",
  "model": null,
  "commit": "38316bd1bf8e2523545968b7324fad5e9124caf7",
  "workingTreeDirty": false,
  "requestIdHash": "0ff140602c4b141a6acd",
  "syntheticOnly": true,
  "mockedTransport": false,
  "fixtureClock": "2026-10-17T10:00:00.000Z",
  "cases": [],
  "reason": "MODEL_NOT_CONFIGURED",
  "latencyMs": 7
}
```

The managed environment reported no secret bindings or runtime model variables.
There is no configured model/key for this run. No provider was silently substituted,
no transport mock was used, and no model HTTP inference was attempted. The selected
network policy also does not list the OpenAI/Gemini API hosts, so legitimate model
setup must include supported egress. No attempt was made to bypass that policy,
read private secret files or ask for payment/production credentials.

An earlier preflight at `d79b077` also reported `MODEL_NOT_CONFIGURED`; the evidence
above supersedes it. An initial sandbox invocation could not obtain Git metadata
(`spawnSync git EPERM`) and was not counted as a verification pass. The script now
catches metadata failures and returns BLOCKED safely; the supported runtime
permission produced the clean-commit result above.

## Reproduction with legitimate private configuration

Use the existing intended `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` privately. The
adapter preserves those values and the application's existing default model names;
it never switches provider after failure. Do not paste keys into chat, code or logs.
When using a private environment file:

```sh
NODE_USE_ENV_PROXY=1 PAYMENT_MODE=fixture node --env-file-if-exists=.env.local --import tsx scripts/verify-financial-model.ts
```

Use a runtime supporting the normal environment proxy and CA trust. Allow the chosen
provider's official API host through the supported environment configuration; do not
unset proxies or disable TLS. No payment engine is imported or invoked by this script.
It refuses a nonfixture payment mode and uses only A's fictional repository/clock.

PASS requires all ten synthetic scenarios: two varied general responses, attributed
product knowledge, exact full-source October totals with partial/fictional labels,
search/detail/evidence multi-step planning, ambiguous search, scoped smaller-candidate
follow-up, honest no-results behavior, draft handoff and execution refusal. Each
scenario runs the actual configured adapter and the real fixture dispatcher. There
are no transport hooks, simulated successes or parser fallbacks in the script.

Output includes commit/dirty status, provider/model, time, schema outcome, latency,
call counts and a hashed random correlation ID. It never prints prompts, answers,
provider bodies, authorization headers, keys or raw financial records. Any failed
scenario, missing setup, HTTP/schema/deadline failure or metadata problem remains
BLOCKED with exit 2. Scripted adapter tests are useful regression checks only.

Already-transmitted model data cannot be recalled. Future real-data runs require
separate consent, identity, retention/deletion and model-data-policy approval; this
script deliberately verifies synthetic records only. Integrated routes, persistent
storage, browser experience, banks and deployment are not verified by MODEL-01.

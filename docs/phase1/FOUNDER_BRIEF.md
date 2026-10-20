# AGUS Phase 1 — Francis's brief

**PHASE 1 COMPLETE: the audit and handoffs are ready for your review. No Phase 2
features have been implemented or agents launched.**

The audit starts from main commit `a73d96c92d57df812485b66213689658e6c80391`.
All five documents are on `docs/agus-phase1-foundation-20261017`, isolated from main.

## What was checked

We reviewed the code, payment safeguards, AI adapters, database, tests, deployment
guidance and existing GitHub branches/PRs. The payment and conversation work is
already merged, including Gerald's dictation work. There was no open engineering
PR to duplicate. An older film branch contains media work and should stay separate.

A clean install, all **215 tests**, typecheck, production build and HTTP payment
smoke passed. Lint failed because three committed editor-history files contain
merge-conflict markers. Four browser suites passed; the fifth failed while checking
bank-loading recovery. The full command therefore failed. Details are recorded in
[READINESS_REPORT.md](READINESS_REPORT.md). Tests use simulated payments and mocked
model/provider responses. No real model connection, bank account connection or real
payment was established by these tests. No payment logic, live settings, secrets,
repository visibility or team permissions were changed.

## What AGUS can honestly demonstrate now

An authenticated operator can prepare one or several payments, review verified
fictional beneficiaries, approve with a password, separately submit simulated
transfers and track unresolved outcomes. Messages and drafts persist. Spending
figures are calculated by code from labelled fictional records.

OpenAI/Gemini and Paystack adapters exist, but their genuine account-level operation
is not verified here. The offline parser is a limited labelled demo tool. Current
financial narration is produced by server code; model-written financial claims are
blocked. Wema/Mono integration, real transaction memory, vague transaction search,
payment-evidence retrieval and multi-user account isolation are still future work.
The architecture documents describe these next steps; they are not working features.

## Exactly what to launch next, after your review

1. **Gerald G0:** a small baseline-repair PR for accidental tracked `.history`
   files and the bank-loading retry regression, followed by complete checks.
   Ask Gerald to coordinate all engineering,
   confirm integration base and review the shared data contract before parallel work.
2. **Codex Agent A:** publish/freeze the typed transaction/consent/tool contract,
   then build scoped fictional data, deterministic search/calculations and evidence
   views. No payment-engine or model changes.
3. **Codex Agent B:** review A's frozen contract, then build the bounded read-only
   model/tool loop, fact-grounded responses and persisted follow-up selections.
   Prove a genuine model call with synthetic data if legitimate private access exists;
   otherwise report that gate blocked. No invented successful inference.
4. **Antigravity:** after A's schema is ready, prepare only labelled synthetic data,
   expected totals, documentation and repetitive QA in its assigned paths.
5. **Gerald G1:** integrate A and B, wire scoped persistence and authenticated read
   routes, test the complete fixture experience and prepare deployment/release evidence.
6. **Codex UI Agent:** polish the interface only once Gerald freezes a stable core.
   **Independent Reviewer:** assess the integrated candidate, grounding, permissions
   and regressions before any release recommendation.

Copy the full work package from [WORKSTREAMS.md](WORKSTREAMS.md), including file
ownership and acceptance tests, into each assignment. Do not ask several agents to
“improve the whole app.” Separate branches/worktrees and one owner for shared files
prevent silent overwrites. These documents do not authorize merges or deployments.

## Deadline and fallback

October 18: clean baseline and freeze contracts. October 19: independent data/tool
modules. October 20: core integration and genuine model check if access exists.
October 21: stable-core UI polish, complete tests and independent review. October 22:
freeze by 10:00 WAT, final rehearsal by 14:00, target submission by 16:00 before the
**17:00 WAT hard deadline**. Reduce scope if gates miss; preserve an honest fixture
demo. Do not rush real accounts, live payments, a PWA or Wema/Mono adapters into this
screening build.

If selected for the potential November 6 Lagos finale, separately authorize a
read-only provider adapter only after legitimate access and consent requirements
are known. Prioritize identity, reliable storage, operational checks and security
review. The conditional roadmap is in `WORKSTREAMS.md`; selection alone does not
authorize live payments.

## First message to Gerald

> Gerald, please review `docs/phase1/` on `docs/agus-phase1-foundation-20261017`
> against baseline `a73d96c92d57df812485b66213689658e6c80391`. Send me your assessment
> of the `.history` lint blocker, the bank-retry browser failure, the proposed data/tool contracts and the integration
> plan before I launch Phase 2. You will coordinate engineering and shared-file
> ownership once authorized. Keep the payment engine and live flags unchanged;
> plan for a verified fixture demo by 22 October, 17:00 WAT, if external access is
> unavailable. Follow `GERALD_HANDOFF.md` and `WORKSTREAMS.md` for exact responsibilities.

Your next decision is whether to accept these contracts and authorize the bounded
work packages above. Production credentials, real account connections and live
money movement remain outside this plan.

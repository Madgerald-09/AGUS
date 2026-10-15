# Architecture

One Next.js App Router application, one PostgreSQL database, one authenticated business-account operator. React/Tailwind UI calls server routes. Drizzle manages PostgreSQL records. PGlite offers a persistent PostgreSQL implementation for single-process fixture development.

## Files and boundaries

- `src/lib/domain.ts`: validated integer-kobo instructions, references, statuses, digests, fictional ledger.
- `src/lib/db.ts`: schema, revision-based atomic workflow aggregate, persistent sessions and login limits.
- `src/lib/auth.ts`: scrypt verification, opaque hashed sessions, origin checks, password throttling.
- `src/lib/paystack.ts`: typed provider interface, real REST adapter, clearly separate fixture provider, signature verifier.
- `src/lib/payments.ts`: preparation, verification, editing, approval, one-use submission claim, OTP, reconciliation, webhook lifecycle.
- `src/lib/intelligence.ts`: OpenAI/Gemini adapters, strict extraction schema, constrained tools, persisted conversation, deterministic insights and CSV.
- `src/app/api/[...path]/route.ts`: HTTP authentication/reauthentication boundary.
- `src/components/dashboard.tsx`: conversation, editable drafts, review, execution, jobs, history and insights.
- `scripts/reconcile.ts`: read-only scheduled verification; no authority to submit.

## Approval and execution

Draft → beneficiary verification → awaiting user approval → approved → submitted → processing / awaiting OTP / unknown → successful / failed / reversed.

Each payment receives a unique UUID-derived reference satisfying Paystack's 16–50 character lowercase/digit/dash/underscore contract. Resolve requires a supported bank and matching returned account number. Provider-returned names and created recipient codes are stored; user-entered labels do not replace verified names.

The server constructs a SHA-256 digest over batch identity, owner, environment, revision, fee reserve, immutable payment details and recipient codes. The UI binds acknowledgment to that exact digest and sends the acknowledged digest during password-reauthenticated approval. A changed digest remounts the review card, clearing acknowledgment and passwords. Approval records contain the actor, time, expiry, snapshot, nonce and digest. Editing increments the revision, invalidates approval, removes verification, and assigns new references. Submitted instructions cannot be edited.

Execution checks the server's approval, digest, one-use nonce, expiry, environment, limits, emergency state and live prerequisites. It queries the transfer balance and reserves principal plus estimated fees, conservatively accounting for other in-flight local jobs. An atomic compare-and-swap update consumes approval and marks all transfers submitted **before** any outbound POST. Two concurrent requests cannot both consume the approval. Provider calls never run inside a replayable reducer.

If the process stops after claiming but before calling Paystack, the job remains submitted. Verify the same reference; never silently generate a new transfer or automatically resend. If verification cannot find it, preserve unknown and investigate. Conservative handling can require human operations work; it prevents uncertain transfers from being paid twice.

Each batch is a coordinated set of single transfers. Partial completion is possible and visible. There is no promise of financial atomicity across recipients. A failure does not roll back another successful transfer. No provider safeguard is disabled.

## Status evidence

Initiation only yields processing or awaiting OTP, even if an initiation payload says success. OTP finalization first persists a one-use claim and increments the operation generation. Responses from older generations are audited without changing lifecycle state. Once claimed, OTP cannot reopen; uncertain or interrupted finalization requires read-only verification and investigation, never another automatic or manual finalization POST. Reference verification independently checks reference, amount, currency and environment. Live mode additionally requires the configured integration ID; string, object and numeric recipient representations are normalized. Every available code, stored recipient ID, bank and account is checked for conflicts; verified outcomes require affirmative matching identity evidence. Verification records status and confirmed integer-kobo `fee_charged` or compatible `fees` separately from the fee reserve. Success cannot regress to processing; reversal can supersede success.

Webhooks validate HMAC-SHA512 on raw bytes using constant-time comparison before parsing or writing anything. Payload SHA-256 deduplicates receipts, while separate durable work records track attempts, errors and completion. Receipt and work enqueue commit together before network I/O. Signed transfer events are audited and independently verified by reference. The scheduled reconciler retries unfinished work even for a previously successful payment; a timeout preserves that last confirmed state without discarding reversal work. A reversal stays queued if verification still reports success. Completion and confirmed state commit together. Duplicates can retry pending verification; out-of-order responses cannot undo reversal. Event delivery is not itself sufficient evidence of recipient credit.

## Persistence and concurrency trade-off

The MVP stores payment batches, messages, ledger and append-only application audit records in a singleton JSONB workflow aggregate, with a revision CAS for every mutation. Sessions and rate limits are separate relational tables. This makes approval consumption, webhook deduplication, history and audit writes atomic without distributed infrastructure. All reductions are synchronous and side-effect free; contention retries read the newest revision.

This is appropriate for a small single-business hackathon demonstration. It is not a high-volume payments database: every mutation rewrites the aggregate, histories grow without partitioning, and contention is global. Before broader rollout, normalize batches, transfers, approvals, provider responses, messages and webhook inbox into indexed tables; retain unique references, optimistic revisions, atomic approval consumption and idempotency. Move the durable reconciliation work to indexed rows and add tamper-evident audit export. Existing JSON snapshots recover receipt-only work and consumed OTP claims from retained audits without a SQL schema change. Database-admin access can currently modify audit rows; this is not a regulatory-grade immutable audit log.

Embedded PGlite must have one process and durable disk. Use managed PostgreSQL for multi-instance hosting and all live use. Backups and restore drills are deployment responsibilities.

## AI boundary

Models return validated intent and draft data only. They do not calculate money or state transaction outcomes. Status and spending responses are generated from database facts and integer arithmetic. Text can create unverified drafts; images can only prefill an editable form. No model result can call approval, execution, or OTP finalization. Prompt injection may corrupt extracted proposals; it cannot grant server authority. Human review and provider resolution remain mandatory.

The demo parser is intentionally small and labeled; it never invents account numbers. Real model adapters accept conversation context but no secrets or session tokens. No banking-data aggregator is implemented. `BankingDataSource` is a future consent-based interface, separate from business payouts.

## Authentication and deployment boundary

A single configured operator password is stored as a salted scrypt hash. Random session tokens are hashed in storage, HttpOnly, SameSite=Strict, one-hour TTL, and Secure for HTTPS origins. Mutating browser requests require the exact configured Origin. Login and password reauthentication share persistent rate limits. An authenticated operator may use the emergency stop; the environment-level switch cannot be cleared from the UI.

This prototype has no multi-tenant roles, MFA, bank-grade device binding or administrator workflow. Use TLS, private operator access and infrastructure controls for a tightly scoped supervised demo. Review stronger authentication, MFA, access recovery, monitoring, data retention and independent security assessment before production use at scale. No production deployment or payment has been authorized by this task.

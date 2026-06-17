# GuardRail (PressPay Plan 1) — progress ledger

Plan: docs/superpowers/plans/2026-06-17-guardrail.md
Branch: feat/guardrail (from main @ dcc83b1)
Base commit before Task 1: dcc83b1

## Tasks
- [x] Task 1: Test harness + policy storage
- [x] Task 2: Reputation-scaled per-tx cap
- [x] Task 3: Store-derived signal helpers
- [x] Task 4: Decision engine + HTTP mapping
- [x] Task 5: Persistent approval queue
- [x] Task 6: Async gate (signal-gathering wiring)
- [x] Task 7: Paywall interposition + PaymentEvent extension
- [x] Task 8: Admin API routes
- [x] Task 9: GuardRail dashboard page
- [x] Task 9.5: Security hardening (auth gate + input validation) — inserted after CRITICAL security review
- [~] Task 10: First deploy + smoke — `npm run build` PASSES (all routes incl. guardrail compile). `vercel --prod` deploy + live smoke = USER ACTION (needs Vercel auth + env vars SELLER_ADDRESS/BUYER_*; optionally GUARDRAIL_ADMIN_TOKEN to lock admin routes for public judging).

## ⚠️ PRE-DEPLOY DECISION (Task 10 / user)
- GuardRail admin routes (`PUT /api/guardrail/policies`, `POST /api/guardrail/approve`) have NO AUTH. After the Vercel deploy they are PUBLIC — anyone could change the policy or approve escalated payments. OK for a throwaway hackathon demo; add a shared-secret header or basic gate before any non-demo use. Decide at Task 10.

## Minor findings (for final review triage)
- policy.ts readAll() swallows malformed JSON (returns {} → next save overwrites). Matches existing store.ts `catch { return [] }` convention. Same pattern recurs in approvals.ts. Decide at final review whether to narrow to ENOENT.
- policy.ts savePolicy() non-atomic write (no temp+rename). Matches store.ts. Low risk for hackathon.

## Final whole-branch review (opus, dcc83b1..48a622b)
- Verdict: NO Critical. "Ready to merge with fixes" — only required fix was a doc comment. Applied cb929d4 (Promise.all gate reads + cross-merchant aggregation comment). 39/39, tsc 0, npm run build PASSES.
- KEY DEFERRED (for fleet/multi-merchant plan): daily-cap + velocity signals key on agent/payer only (PaymentEvent has no merchantId) → caps aggregate across ALL merchants. Invisible/harmless for single-merchant "press" demo. To get true per-merchant isolation: add merchantId to PaymentEvent + filter signals. Documented in gate.ts comment.
- Other Minors deferred (hackathon-acceptable): readAll swallows malformed JSON / non-atomic writes (matches store.ts; .data ephemeral on Vercel); engine allowlist .map per call; dashboard PUT-per-keystroke + no payments empty-state; validate permissive bounds; signals falsy agentId guard. Cache-TTL mismatch already tracked in spec §10.

## Log
- Task 1: complete (commits dcc83b1..05a024c, review clean). Plan corrected to extensionless TS imports (TS2307/next build); fix commit 3d7fa26. Base for Task 2 = 3d7fa26.
- Verified `npx tsc --noEmit` = 0 errors → LSP "cannot find module" diagnostics on extensionless imports are STALE; ignore them.
- Task 2: complete (commit ebd7831, review clean). Base for Task 3 = ebd7831.
- Task 3: complete (commit d38f839, review clean). Minors: falsy `if(e.agentId)` treats "" like null (harmless — agentId never ""); "addr:unknown" double-null sentinel undocumented. Base for Task 4 = d38f839.
- Task 4: complete (commits 8d2fe13 + fix 94b86bd, re-review clean). Reviewer-1 flagged decision order as Critical/Important; CONTROLLER ADJUDICATED as false positive — escalate-before-cap is behaviorally equivalent to spec's "over cap AND ≤ threshold → deny" (no contradicting input exists). Corrected plan prose to match code; added clarifying comment + discriminating test (low-rep above-threshold → escalate). Re-review (against corrected brief) Approved. Minors: allowlist `.map().includes()` rebuilds per call (use Set); allowlist test doesn't exercise case-normalization. Base for Task 5 = 94b86bd.
- Task 5: complete (commits 67f480f + fix 3243751, re-review Approved). Fixed Important: resolveApproval now ignores re-resolve of already-resolved (resolution is final) + test. NOT fixed (matches store.ts convention, safe): listPending/getApproval read outside lock. Minors: MAX=500 silent drop; resolvedAt ISO format not asserted. Base for Task 6 = 3243751.
- Task 6: complete (commit 13471fc, review Approved). Report lost to session cutoff; controller verified files match brief + 31/31 pass + tsc clean. Minors (plan-mandated): sequential getReputation/listPayments could be Promise.all; listPayments(1000) hardcoded. Plan-prose Task4 fix committed 701b215. Base for Task 7 = 701b215.
- Task 7: complete (commit ad55a76, review Approved). Verified: 31/31, tsc 0, curl guarded+summarize both 402 (no-op path intact). ADJUDICATED Important (awaited enqueueApproval): KEPT await — it's a local file write (sub-ms) and on Vercel serverless not-awaiting risks dropping the write when the fn freezes after the 202. ⚠️ guardrailResponseFor-null-for-allow confirmed from Task 4. Minors: gr* locals declared outside if-block (plan-mandated, zero behavioral impact); removed an agentId doc comment (restore in final/simplify). Base for Task 8 = ad55a76.
- Task 8: complete (commit 662be6e, review Approved). Verified tsc 0, 31/31, policy round-trip + bogus-id 404. Minors: malformed JSON body → 500 (MVP ok); NO AUTH on admin routes (see PRE-DEPLOY DECISION above). Escalate→approve live loop deferred to testnet. Base for Task 9 = 662be6e.
- Task 9: complete (commit fb6830a, review Approved). Reviewer Importants (unguarded /pending fetch, unawaited refresh(), unhandled /policies fetch) → folding into Task 9.5 hardening (touching the page anyway). Minors: PUT-per-keystroke; no payments empty-state.
- Task 9.5 (security hardening): triggered by commit+push security reviews (CRITICAL no-auth on policies PUT + approve POST; HIGH mass-assignment via ...body spread; HIGH /pending info disclosure). Approach: lib/guardrail/validate.ts (tested whitelist validator, blocks mass-assignment + __proto__ via merchantId charset), lib/guardrail/admin-auth.ts (optional GUARDRAIL_ADMIN_TOKEN bearer gate, constant-time, open when unset), gate all 4 guardrail admin routes, dashboard sends optional bearer from localStorage, + Task 9 reliability fixes. Base = fb6830a.
- Task 9.5: complete (commit 48a622b, security re-review Approved). All 4 CRITICAL/HIGH findings fixed (39/39 tests, tsc 0, curl open-mode 200 + __proto__→400 + token-mode 401/200). Implementer correctly added MERCHANT_BLOCKLIST since regex allows underscores. Both commit+push security sweeps resolved. Note: /api/payments intentionally public (pre-existing seller feed). Base for Task 10 = 48a622b.

# Verifying pending question & approval replay

The unit tests (`src/server/questions.test.ts`, `src/server/sessions.test.ts`,
`src/server/orphans.test.ts`) drive the hub state machine with a stubbed
`ctx.cline` and in-memory peers. They prove the bookkeeping — park, replay,
grace, resolve — but they never open a socket, never render React, and never
run an agent turn. The checks below cover the parts only a live turn reaches:
the real `ask_followup_question` / tool approval call, the real WebSocket, the
real browser reload, and the resume of the parked turn.

Run the automated suites first:

```bash
cd apps/cline-hub
bun run -F @cline/cline-hub typecheck
bunx vitest run --config vitest.config.ts
```

## 0. Setup

```bash
cd apps/cline-hub
bun run -F @cline/cline-hub build:webview   # skip if you use `bun run dev`
bun run start
```

Open <http://127.0.0.1:8787>. The server discovers or spawns the local detached
hub and prints its endpoint.

An agent turn needs a provider credential. Pick one:

- **Providers** in the dashboard — add the key there (it is saved through
  `saveProviderSettings`).
- **OAuth** — sign in from the dashboard provider list.
- Environment — `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `CLINE_API_KEY`, …

Keys land in `~/.cline/data/settings/providers.json` (`ProviderSettingsManager`,
written with mode `0600` on POSIX). Prefer entering them in the dashboard over
pasting them into a chat or a shell history.

A local endpoint works too, so no external account is required: an
OpenAI-compatible server (`openai-compatible` / `litellm` provider with
`baseUrl` + model + any placeholder key) or Ollama, which needs no key at all.
Pick a model that is good at tool calling — tests 1 and 4 depend on the agent
actually emitting `ask_followup_question` / a tool call. If a small local model
will not call tools, run test 4 (file edit approval) and test 5, which only need
an ordinary tool call.

Point the hub at a scratch workspace with `WORKSPACE_ROOT=/path/to/scratch` so
the approval tests can touch files you do not care about.

Tip for the grace tests: `PEER_DETACH_GRACE_MS` in `src/server/orphans.ts` is a
constant. Temporarily set it to `10_000` to avoid waiting 90 seconds, and put it
back afterwards.

Watching frames: DevTools → Network → WS → select the `/browser` connection →
Messages. Filter on `question_request` / `approval_request`.

## 1. A follow-up question survives a reload

1. Start a session and prompt:
   `Use the ask_followup_question tool to ask me which colour to use, options
   "red" and "blue". Do not continue until I answer.`
2. Confirm the card renders with the question and both options.
3. Reload the page (F5 / pull-to-refresh).
4. Open the same session from the session list.

**Expected:** the question text and both options reappear, and the DevTools
Messages pane shows a `question_request` frame after `session_hydrated`.

**Failure signature:** transcript loads, no card. The replay is not wired into
the attach path you used (`selectSession` / `loadSessionIntoMemory` /
`createSession`).

## 2. Answering from the reloaded page resumes the parked turn

Continue from test 1 and click an option.

**Expected:** the agent continues with your answer in the transcript, and the
card disappears (`question_resolved`).

**Failure signature:** the transcript contains
`No Cline Hub browser client is attached to this session, so the user did not
answer.` — the question was resolved on the peer's behalf instead of being
replayed, so the answer you clicked went to a dead `questionId`.

## 3. A mirrored question from another client

1. Open the dashboard in a second tab (or a phone on the LAN with
   `ROOM_SECRET`).
2. Ask the question from the first peer's session.

**Expected:** the second peer sees the same card, with `remote: true` in the
frame, and answering from it delivers the answer to the owning session.

## 4. A tool approval survives a reload

1. Turn auto-approve off for file edits.
2. Prompt: `Create notes.txt containing the word hello.`
3. Confirm the approval card shows the diff.
4. Reload, reopen the session.

**Expected:** the approval card is back (`approval_request` after
`session_hydrated`), and approving it executes the edit.

**Failure signature:** the card is gone and the transcript reports
`Cline Hub webview disconnected before approval was resolved.`

## 5. No duplicate cards

1. With a question parked, switch to another session and back a few times.
2. Reload once more.

**Expected:** exactly one card. The webview upserts by `questionId` /
`approvalId`, so replayed frames replace the card rather than stacking it.

## 6. Grace expiry resolves parked work

1. Park a question (test 1) and close every peer watching that session.
2. Stay away for longer than the grace period.

**Expected:** after the grace expires the question is answered with
`No Cline Hub browser client is attached to this session, so the user did not
answer.` and any pending approval is rejected with
`Cline Hub webview disconnected before approval was resolved.` — the agent is
released instead of hanging forever.

## 7. Reattach within the grace cancels cleanup

This is the test a unit test cannot fake. Closing a socket runs
`scheduleOrphanCleanup`; attaching runs `selectSession` → `replayParkedState` →
`cancelOrphanCleanup`. A real reload fires close-then-attach within a second, and
only a browser produces that ordering. If the cancel does not happen, the question
is answered on the peer's behalf 90 seconds after the reload — the agent continues
with a fallback answer the user never gave.

**Preconditions**

- **No other peer may be watching that session.** `hasSelectedPeer` counts browser
  peers (dashboard tabs, phones), so close every other tab and device attached to
  it. The desktop app's observer is a hub client, not a browser peer, so it does
  not keep the session alive.
- **Copy the chat URL first** — it is `…/?id=<sessionId>`. The webview reads the
  `id` query param on load and auto-attaches, so reopening that URL attaches in
  about a second. Opening `/` instead means clicking the session in the list,
  which eats into the window.
- Optional: set `PEER_DETACH_GRACE_MS = 10_000` in `src/server/orphans.ts` so you
  are not timing 90 seconds, then restore it.

**Steps**

1. Park a question (test 1) and note the `questionId` in the WS Messages pane.
2. Keep DevTools → Network → WS open, then **close the tab**. The countdown starts
   at socket close, not when you clicked.
3. Stay away for 10–30 seconds — inside the grace window.
4. Reopen the copied `?id=` URL.
5. Answer the question from the reloaded page.
6. Leave that tab open past the grace deadline (90 s from the close) and confirm
   nothing resolves.

**Expected frames after step 4**

```
session_started     { sessionId }
session_hydrated    { sessionId, messages: [...] }
question_request    { questionId, question, options }   <- same questionId as step 1
```

**Expected after step 5:** `question_resolved` carrying your answer, and the agent
continues with it.

**Failure signatures**

| Symptom | Cause |
|---|---|
| Card is back and the answer is accepted, then ~90 s after the close the transcript gains `No Cline Hub browser client is attached to this session, so the user did not answer.` | `cancelOrphanCleanup` never ran. `replayParkedState` is called from exactly three places — `selectSession`, `loadSessionIntoMemory` and `createSession` (restore and fork reach it through `loadSessionIntoMemory`) — so an attach that bypasses all three leaves the countdown running |
| Card is gone after reopening | Replay is not wired into that attach path |
| Clicking an option does nothing (no `question_resolved`) | The replayed `questionId` differs from the parked one, so the answer targets a dead id |
| Transcript gains `No answer was received before the question timed out.` | That is the question's own 10-minute `QUESTION_TIMEOUT_MS`, not the grace window |


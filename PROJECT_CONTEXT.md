# Project context

John Mustard is a WhatsApp assistant using Node.js built-ins, SQLite, WAHA,
and an isolated Python runner. See AI_RULES.md and FEATURES.md for contracts.

## Fix verification — 2026-11-05 (Asia/Jakarta)

- Reminder timers track their armed time and reload the row before sending;
  changed near-horizon reminders re-arm on the next scheduler tick (normally 15s).
- Debounced text followed by media preserves the media payload. Batches stop
  at sender boundaries and the first media item.
- SSRF checks distinguish IPv6 ULA addresses from fc/fd-prefixed hostnames,
  and revalidate redirect destinations.
- Scheduler and MCP routes require BOT_API_TOKEN and reject missing configuration.
  The scheduler container receives the token and sends the bearer header.
- Bot host port 4500 binds to loopback. Runner no longer mounts the vault or
  reads client-supplied disk paths. Minecraft has no default remote host.
- Verification: npm test passed (179 Node tests, module self-tests, Python runner).
  Isolated staged-tree npm test passed: 159 Node tests, module self-tests,
  and Python runner. Focused regression suite passed 16/16. Docker Compose
  config validated using placeholder SSH and API token environment values.

## Remaining scope

- Webhook authentication remains unimplemented; WAHA and 9router host ports
  still bind to all interfaces. Security remediation is not complete.
- Logbook/Sheets and reply-style work exists separately in the working tree;
  those changes are outside this fix commit.
- Local verification does not establish VPS deployment or production settings.

## Commands

- npm test: required full suite, including Python runner dependencies.
- node --test tests/scheduler.test.js tests/ssrf.test.js tests/queue.test.js:
  focused regression checks.

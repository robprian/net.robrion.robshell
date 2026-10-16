# Cursor investigation, 2026-10-16

Status: unresolved on the user's live SSH terminal. The user confirmed that
v1.3.4 still drifts immediately after reopening the SSH tab. No live cursor fix
is claimed, and development v1.3.5 has not been published or loaded into DBX.

The reproduced shared-channel failure is now addressed in source: a backend
exec attempt can emit plain CR/LF outside the marker envelope, including when
the attempt fails. Filtering metric/marker lines leaves these bytes untouched;
scanning for a visible marker cannot detect them. Periodic exec/disk retries
therefore keep advancing the native cursor. `drv-idle.js` models this backend
and failed on startup and repeated-refresh cursor stability before the change.
It passes after blocking all monitor exec in interactive PTY mode, including
startup, disk retries, and upgrades. SFTP metrics remain active. Disk stays N/A
without an isolated collector, and silent cwd metadata preserves directory
following. The actual affected server's raw bytes remain unavailable.

## Confirmed findings

- The running sidecar path identifies installed v1.3.4.
- Source contains one xterm constructor, one DBX event subscription, and one PTY
  write funnel. `.rs-cursor` has CSS hooks but no element creation code.
- An old `monStart()` failure can disable a newer successful monitor startup.
  The new regression in `drv-pty.js` failed before the generation guard and
  passed afterwards. This race's relationship to visual drift is unconfirmed.
- The configured DBX MCP endpoint was reached through Windows PowerShell. It
  advertised 76 tools, none for RobShell inspection/reload. Its separate
  Terminal-plugin saved-connection tool returned an empty session registry and
  reported that its DBX connection-list bridge did not answer.
- No remote-debugging endpoint was available for the running DBX WebView.
  Ctrl+Shift+I did not expose DevTools. The user confirmed neither DevTools nor
  a debugging endpoint was available. Windows refused the foreground request
  used to attempt Plugin Center automation; that approach was stopped.

## Native-renderer control test

The complete shipped HTML/CSS/xterm code was run in a separate headless Windows
Chrome profile. A synthetic bridge supplied an SSH session, one synthetic
prompt, and SFTP metric fixtures; exec was rejected. No actual SSH server or
DBX WebView was involved. Measurements used real elapsed time, not virtual
timers:

```json
{"elapsedMs":300013,"initial":{"x":18,"y":0,"base":0,"viewport":0},"final":{"x":18,"y":0,"base":0,"viewport":0},"stationary":true,"terminalInstances":1,"bridgeSubscriptions":1,"extraWrites":0,"metricReads":644,"customCursors":0,"samples":300}
```

This establishes a stable native cursor for the controlled SFTP path. It does
not validate the affected live SSH stream, DBX compositor, resizing, tab
switching, reconnecting, or interactive TUIs.

A second real-time control ran the monitor-isolation change with a synthetic
backend that emits an unframed CR/LF on every exec attempt. The backend was
never invoked. With `[robby@mail ~]$ ` displayed, the results were:

```json
{"elapsedMs":300005,"execAttempts":0,"initial":{"x":16,"y":0,"base":0,"viewport":0},"final":{"x":16,"y":0,"base":0,"viewport":0},"stationary":true,"terminalInstances":1,"bridgeSubscriptions":1,"extraWrites":0,"metricReads":644,"customCursors":0,"samples":300}
```

This is a real five-minute native-xterm measurement with synthetic SSH/SFTP
events, not a live DBX/SSH acceptance result.

## Automated verification

- Shipped application JavaScript syntax: passed.
- Monitor/suggestion/theme unit scripts: 70 + 62 + 445 assertions passed.
- All ten VM integration scenarios: 230 assertions passed, including unsafe
  shared-exec newline reproduction, disabled probes/retries, live metric fixture
  refresh, quiet directory tracking, input bytes, and alternate-screen controls.
- Update scenario rerun after the development version change: 31 passed.
- `node tests/terminal-trace.test.js`: passed redaction, byte preservation,
  parsed-state observation, and restoration of timers/subscriptions/wrappers.
- Development archive: version/identity, complete SHA-256 coverage, and exact
  entry coverage verified. Diagnostics are excluded from the archive. The
  sidecar change is limited to its single version string.

## Temporary live instrumentation

If a RobShell iframe DevTools context becomes available, run
`tests/terminal-trace.js` in that context. It records the terminal instance ID,
PTY session marker, chunk byte length, redacted escaped output, write origins,
native cursor/base/viewport coordinates, and known monitor timer count. Printable
terminal text and commands are never logged. The host does not expose socket
listener enumeration, so that count is explicitly unknown.

The recorder restores every wrapper and disposes its own cursor listener and
timers automatically after five minutes. It can also be stopped with
`window.__robshellCursorTrace.stop()`. Export its sanitized records with
`window.__robshellCursorTrace.export()`.

The next required evidence is a live trace covering the idle drift. Changes to
native buffer coordinates must be correlated with the preceding raw PTY
controls and write origins; a stationary buffer with a moving rendered cursor
instead requires DOM/compositor geometry inspection. Legitimate newlines and
ANSI cursor sequences must remain intact in either case.

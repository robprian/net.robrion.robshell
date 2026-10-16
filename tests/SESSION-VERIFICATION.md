# Version 1.3.6 verification

The logout/typing regression uses the shipped application script in the existing
VM harness: `node tests/monitor-harness.js session`.

Before the change, the new regression reproduced a delayed printable echo,
automatic reconnect after explicit `exit`, monitoring remaining active after
logout, and a false restored state when cwd metadata succeeded but PTY resize
failed. After the change all session assertions pass, including `logout`, Ctrl+D,
clean EOF, disabled input after exit, and an ordinary `echo exit` command that
must not suppress recovery from a genuine network interruption.

The PTY transcript regression now removes only the known captured monitor
wrapper and metric block. It preserves adjacent prompts and bracketed-paste
controls that the former whole-line expectation discarded. Interactive monitor
exec remains disabled, as in the user-confirmed v1.3.5 release.

## Results

- JavaScript syntax check: passed.
- Monitor, suggestion and theme unit scripts: 70 + 62 + 517 assertions passed.
- All eleven VM integration scenarios: 242 assertions passed.
- Temporary diagnostic recorder tests: passed; diagnostics remain outside the
  packaged UI and do not run automatically.
- Native Windows Chrome with a synthetic SSH/SFTP bridge: 20 assertions passed
  on the desktop fixture and 20 on a 390 px panel fixture. The latter constrains
  the panel width explicitly; this is not mobile-device emulation.
- Native checks covered ordinary echo appearing before the old 150 ms delay,
  intentional logout, an inactive reconnect, one reused xterm, native alternate
  buffers, all eight themes, unchanged terminal bytes during theme changes, no
  custom cursor elements, visible toolbar actions, and cursor alignment after
  the displayed prompt. Browser scheduling used a virtual-time budget, so this
  measures the client buffering policy, not real SSH round-trip latency.
- Screenshots were visually inspected at desktop and narrow-panel sizes.
- Hacker UI foreground, muted text, accent and status colours passed 4.5:1
  contrast checks against all three main surfaces (21 checks).

The agent did not run this build against the user's actual SSH server or DBX
WebView. Version 1.3.5 was published and its three public downloads were hashed
back to the release artifacts. Version 1.3.6 ships these changes; publication does not add live SSH validation.

## UI delivery checks

- Hard gate PASS: the inspected fixtures show a single native cursor and no
  page overflow; the narrow toolbar exposes all actions. Preview data is
  explicitly synthetic test data.
- Purpose gate PASS: monospace metrics, matte dark surfaces and a green accent
  follow the requested hacker-terminal direction. No decorative assets,
  gradients, glow or new cursor animation were introduced.
- Visual hierarchy PASS: connection identity and shell output remain primary;
  compact controls and lower-contrast borders keep attention on terminal text.
  Energy 1, rhythm 2, motion 1; the cursor uses native xterm blinking.
- Craft checks PASS: complete UI/ANSI tokens, preserved saved themes, passing
  contrast tests, visible focus styling, and desktop/narrow browser checks.

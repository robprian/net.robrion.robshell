# Changelog — RShell (`net.robrion.robshell`)

## 1.2.1 — OpenCode dark palette + silent keep-alive (2026-10-16)

### Dark mode is now real dark

- **New default theme: OpenCode.** A neutral near-black palette with no blue
  cast, taken from OpenCode's own default theme
  (`packages/tui/src/theme/assets/v2/opencode.json`, dark mode) rather than
  eyeballed: surface `neutral.800 #0a0a0a`, status bar `neutral.900 #030303`,
  raised panels `neutral.700 #141414`, hover `neutral.600 #1e1e1e`, text
  `neutral.200 #eeeeee`, muted `neutral.400 #808080`, border `#484848`,
  scrollbar `#606060`, accent `purple.200 #9d7cd8`, interactive/cursor
  `orange.200 #fab283`, error `red.200 #e06c75`, success `green.200 #7fd88f`,
  info `cyan.200 #56b6c2`, warning `#f5a742`. The bright ANSI half is taken from
  the same hue ramps (`blue.100/200`, `green.100`, `red.100`, `purple.100`,
  `cyan.100`) so real-colour output stays inside the palette.
- The theme list is now **OpenCode** (default), Tokyo Night, Catppuccin Mocha,
  Dracula, Nord, Gruvbox Dark, Light. Tokyo Night is unchanged and still
  selectable — only the *default* moved, so nothing was taken away.
- **One-time migration** (`SETTINGS_REV = 1`): a saved settings blob that never
  picked a theme (old default `tokyoNight`, or the legacy `dark`) follows the
  default forward to OpenCode once, then stays wherever you put it. Picking
  Tokyo Night afterwards sticks.
- **No lighter layer can flash through.** `#ptyHost`, `.xterm`,
  `.xterm-screen`, `.xterm-rows` and `.xterm-viewport` are all painted with the
  same `--rs-bg`, so a repaint at a sub-pixel row seam or a half-painted new row
  cannot reveal a different shade underneath.

### Keep-alive no longer writes to the terminal

- **Bug: a blinking line at the prompt.** Keep-alive used to push `" \x7f"`
  (space + DEL) into the PTY. The remote line editor echoes the space and then
  erases it, which repaints the prompt line; when readline's cursor bookkeeping
  is off by one (auto-wrap, long prompt, full-width output) the repaint emits a
  **spurious newline — a line that appears and then disappears**, roughly once
  per keep-alive interval and most obvious on the fresh line right after you
  press Enter.
- Keep-alive now warms the transport with a request that produces **no terminal
  output at all**: the same `shell/cwd` round-trip the RTT probe already uses,
  on the same authenticated connection. Zero bytes reach the PTY, so there is
  nothing to echo, nothing to repaint and no phantom line. It is now also safe
  during full-screen programs (`vim`, `less`, `man`) instead of being held back.
- Still gated: never while a monitor sample holds the backend's single exec
  slot, never when the session is not connected, and only after the configured
  idle interval. Off by default.
- The now-unused `shell/input` keep-alive writer was removed, and the setting
  hint text (en/zh) was corrected to describe the silent probe.

### Tests

- **740 assertions green**: 70/70 monitor core, 62/62 suggestion core,
  **445/445 theme core** (OpenCode palette values, neutrality of the grey
  channels, 7-theme registry, migration) and **163/163** headless integration.
- The `conn` scenario gained a hard regression check for the blink bug: while
  keep-alive is enabled and the session is idle, **zero `shell/input` payloads**
  are sent (and specifically never `" \x7f"`), the probe is exactly one
  `shell/cwd` request, it writes nothing to the terminal, and the alternate
  buffer is safe. `window.__robshell.keepAlive.probe()` is exposed for manual
  checks.

## 1.2.0 — RShell rename, session resilience, premium terminal (2026-10-16)

### Renamed to RShell + lighter icon

- **Plugin identity renamed.** `com.robshell.shell` → `net.robrion.robshell`;
  display name **My Terminal** → **RShell**; publisher `robshell` → `Robrion`.
  Package is now `dist/net.robrion.robshell.dbxp`.
- The backend is closed-source, so the plugin id it announces at
  `plugin/initialize` (DBX rejects the plugin with *"Plugin backend identity …
  does not match manifest"* otherwise) was updated by binary patch: the identity
  literal's pointer now targets a 20-byte copy in the mapped PE header padding,
  and both length immediates (`18` → `20`) were patched at the two sites that use
  it (`main.main` identity struct and `main.pluginLogDir`). The version string was
  patched in place `1.1.5` → `1.2.0`. Verified with `objdump`.
- Connection-provider ids (`com.robshell.shell.connection`, `com.robshell.ssh.connection`)
  are **unchanged** — they are the keys DBX passes to the backend for provider
  dispatch, and the backend matches them by exact string; only the plugin-level
  identity was renamed. Contribution labels used in the UI are unchanged.
- **Lighter icon.** `assets/plugin.ico` rebuilt from `icon.png`: 44,914 → **32,062
  bytes** (−29%), same size set (16/24/32/48/64/128), PNG-embedded entries.
- Note: the id change makes this a *new* plugin entry in DBX, so it installs
  separately from the old `com.robshell.shell` and settings do not carry over.

### Session resilience — keep-alive + auto-reconnect

- **Auto-reconnect (on by default).** When the backend reports `shell/pty-closed`,
  or a `shell/input` write is rejected three times in a row, RShell walks a
  bounded backoff ladder (0.5 s → 1 s → 2 s → 5 s, then 5 s steady) and re-runs
  the session handshake. **The terminal is never cleared or reset for a
  reconnect** — the same xterm instance is reused, so the scrollback you were
  reading stays on screen and the reconnect notes are appended below it.
- Permanent failures (auth rejected, permission denied, host-key verification
  failed) are recognised and stop the ladder immediately instead of looping —
  the status pill switches to *Authentication failed* and tells you to fix your
  credentials. "Reconnect now" in Settings retries on demand.
- **Keep-alive (opt-in, off by default).** With an interval selected (1/5/10/30/60 s),
  an invisible `" \x7f"` (space + backspace) is written to the PTY while the
  session sits idle so an idle NAT/sshd timeout cannot silently drop it. It is
  never injected while a monitor sample is in flight or while a full-screen
  (alternate-buffer) program owns the terminal, because those do read stdin.
- **Connection state is visible.** A status pill appears in the toolbar only
  when the session needs attention — *Reconnecting…* / *Disconnected* /
  *Authentication failed* — and disappears again once the session is live. The
  compact dot keeps working exactly as before when everything is fine.

### Premium terminal UI

- **Theme system rebuilt around one source of truth** (`RS_THEMES`). Each theme
  now carries a full 18-token UI palette (chrome, borders, scrollbars, selection)
  *and* a complete xterm `ITheme`: `background`/`foreground`/`cursor`/
  `cursorAccent`/`selectionBackground` plus all 16 ANSI colours and their 8
  bright variants. Switching a theme re-tints the chrome through `--rs-*` CSS
  custom properties and the terminal through the xterm theme, **without touching
  the byte stream** — no output is ever injected, rewritten, or recoloured.
- Themes: **Tokyo Night** (new default), **Catppuccin Mocha**, **Dracula**,
  **Nord**, **Gruvbox Dark**, plus the existing Light. Old saved theme keys
  (`dark`, `oneDark`, `monokai`, `solarDark`, `solarLight`) migrate silently.
- **Type:** coding-font stack (JetBrains Mono → Cascadia Code → Fira Code →
  Consolas → monospace), default size 13.5 px (9–24 px), configurable line height
  (1.00–1.80, default 1.45), cursor style (block/underline/bar) and cursor blink.
- **Scrollback** is configurable (100–200 000 lines, default 5 000).
- **Clickable URLs** in the terminal (http/https, `www.`, e-mail) via the xterm
  core link-provider API — no addon bundled, nothing injected into the stream.
  Clicking a link opens it in the default browser; if the host blocks that, the
  URL is copied instead.
- **Context menu** (Copy / Paste / Select all / Clear display / Search… /
  Settings) on Ctrl+right-click or Shift+F10, or on any right-click when
  *right-click pastes* is turned off. Arrow keys navigate, Esc closes. Right-click
  with a selection still copies, and right-click on empty space still pastes —
  neither of the v1.1.5 behaviours was taken away.
- **In-terminal search.** `Ctrl`/`Cmd`+`F` opens a search card with match count,
  prev/next and Esc to close; matches are selected and scrolled into view.
- **Floating copy toolbar** appears while text is selected and confirms
  "Copied" / "Copied N lines".
- **Scrollbars** slimmed to 5–6 px (WebKit, Firefox `scrollbar-width`, and the
  xterm 5.5 custom scrollbar); 14–16 px terminal padding; hover brightening only,
  so nothing shifts layout.
- **Reduced motion** honoured: `prefers-reduced-motion: reduce` stops the pill
  pulse, spinner, metric-bar transitions and cursor blink.
- **Responsive** for desktop / tablet / phone: the single-row toolbar scrolls
  horizontally under 720 px with 40 px tap targets, and panels/search/context
  menu become viewport-fit overlays under 480 px.
- Settings gained an **Appearance** group (theme, font, line height, cursor
  style, blink, scrollback, links) and a **Connection** group (auto-reconnect,
  keep-alive interval, reconnect now).
- Clipboard uses the browser-native Clipboard API with the existing host bridge
  as fallback and explicit error handling; no credentials or clipboard contents
  are ever logged.

### Tests

- 653 assertions green: 70/70 monitor core, 62/62 suggestion core,
  **363/363 theme core** (new) and **158/158** headless integration across seven
  scenarios — including a new `conn` scenario that drives the real app scope to
  prove theme tokens reach both the chrome and the terminal, the context menu and
  search behave, keep-alive injects only when it is safe, and that a reconnect
  **does not clear the terminal** (no `clear()`, no `\x1b[2J`/`\x1b[3J`) while
  still re-running the handshake and restoring the session.

## 1.1.5 — Next-command suggestions + settings toggles (2026-10-16)

- **Next-command suggestion** (modelled on `jinpy666/dbx-plugin-ssh`'s ghost
  autosuggest): while you type the prefix of an earlier command, the rest of it
  is shown as dim inline text after the cursor. `→` accepts the whole
  remainder; `Ctrl+→` accepts one word at a time; `Esc` dismisses.
- A fuzzy match list sits above the input line (fzf-style ranking with the
  matched characters highlighted). `Ctrl+↑`/`Ctrl+↓` pick a row and `Tab` fills
  it; rows are clickable too. Plain `↑`/`↓` are deliberately **not** hijacked —
  they keep walking the remote shell's own history.
- The line model is a keystroke trajectory (printable text, backspace,
  `Ctrl+U`/`Ctrl+W`, `Ctrl+C`, Enter) with bracketed-paste unwrapping; control
  sequences, mouse reports and alternate-screen programs suppress suggestions.
  Password-style prompts are detected from the buffer and suppressed.
- History is captured from the commands you run in the terminal and persisted
  (`pluginStorage`, localStorage fallback, 200 entries, consecutive duplicates
  collapsed). No new host calls and no new permissions: suggestions are local.
- New Settings toggles: **Next command suggestion** (master on/off) and
  **Right-click pastes clipboard**. Right-click with a selection still copies.
- Disk tooltip now names the exec failure reason instead of a bare
  "requires exec transport".
- Monitoring startup now retries the `exec` probe up to 4 times with backoff
  when the backend's single exec slot is briefly held by DBX's own startup
  calls (docker/detect, cwd, SFTP listing) instead of immediately dropping to
  the SFTP transport; when it does fall back to SFTP, it re-probes exec once a
  minute and upgrades in place so disk comes back on its own.
- Tests: 62/62 pure unit assertions (`tests/suggest-core.test.js`) and 100/100
  headless integration assertions across six scenarios (a new `suggest`
  scenario drives the real `onData` handler, key arbitration, history commit
  and both settings toggles).

## 1.1.4 — Reliable disk + self-healing refresh (2026-10-16)

- **Disk metric fixed.** `df -B1 -x overlay …` could exclude the root
  filesystem (common on container/VPS roots that *are* overlay) and GNU `df`
  wraps long device names onto a second line, which broke the row parser.
  Disk now runs `df -Pk` (POSIX, one line per filesystem, unambiguous 1 KiB
  units) with `-P`/`-B1`/`-k` fallbacks, and the percentage is read from the
  Capacity column so it is correct even if the block unit differs.
- **Disk no longer lost when exec is flaky.** Disk needs a shell (no `/proc`
  equivalent), so when the monitor runs on the SFTP transport it now retries
  the exec channel periodically and shows disk as soon as it succeeds instead
  of a permanent `N/A`. Disk and uptime are independent probes now, so a `df`
  quirk can't cost the uptime sample (or vice versa).
- **Realtime refresh fixed.** Bridge calls get a hard local deadline, so a
  wedged host request can no longer freeze the polling loop; a watchdog
  re-arms the timers and forces a sample if none lands for several intervals;
  the panel no longer pauses updates while it is not the focused surface; and
  returning to a visible panel refreshes immediately.
- Diagnostics expanded: `window.__robshell.snapshot()` now reports
  `diskPct`/`diskErr`/`staleMs`/`diskRaw`, and the Disk tooltip shows the
  failure reason.

## 1.1.3 — Right-click paste + multi-line confirm (2026-10-16)

- Right-click pastes when nothing is selected (selection still copies);
  Ctrl+V / Ctrl+Shift+V / Shift+Insert paste via the host clipboard bridge,
  with graceful fallback when unreadable. New `host.clipboard:read` permission.
- Multi-line paste shows a confirmation popup ("Paste N lines?"); threshold
  and on/off configurable in Settings.
- Fixed a variable-shadowing bug that silently skipped the confirm dialog
  (caught by the new paste tests).
- Exec contention ("Another command is still running", e.g. open Docker
  panel) no longer counts toward monitor give-up; ticks simply retry.

## 1.1.2 — Metrics pipeline repair (2026-10-15)

- Fixed empty metrics: flight completion is now marker-driven (END-marker
  grace finish) instead of depending on `shell/exit`, which some backends
  don't emit for PTY-mode execs; startup burst serialized (sysinfo→fast→slow)
  so concurrent execs can't steal each other's flights.
- Explicit lifecycle states (loading/ready/stale/error/disabled/
  disconnected): failures render `N/A` with the reason in tooltips instead of
  permanent `—`; `console.warn` diagnostics + `window.__robshell.snapshot()`.
- Hostname falls back to connection target host when remote `hostname` is
  unavailable.
- Verified with a headless harness running the real shipped UI code:
  5/5 failure-path and 10/10 success-path assertions pass (probe, hostname,
  CPU/RAM/net/disk/uptime, no marker leak into the terminal).

## 1.1.1 — Backend identity patch (2026-10-15)

- Fixed `Plugin backend identity 'com.nintycat.shell/0.8.4' does not match
  manifest`: the Go sidecar hardcodes its id/version and DBX cross-checks it.
  Same-length binary patch (`com.nintycat.shell`→`com.robshell.shell`,
  `com.nintycat.ssh`→`com.robshell.ssh`, `0.8.4`→`1.1.1`; Go string headers
  untouched, no Authenticode cert to break). Manifest ids aligned to the
  patched binary. Display name stays "My Terminal".
- New icon (`assets/plugin.ico`, 44 KB multi-size ICO from `terminal.png`).

## 1.1.0 — Server monitoring status bar (2026-10-15)

Replaces the old `Shell | Ready | …` header with a compact real-time server
monitoring toolbar. No backend changes (reuses the existing
`dbx-plugin-nintyshell` sidecar as-is).

Added:

- New `TerminalStatusBar` header: connection identity (status dot, remote
  hostname, protocol) + live metrics (CPU, RAM, disk, network up/down,
  host round-trip, uptime) + overflow menu + Files/Docker/Clear/Interrupt/Settings.
- Remote Linux metrics over the SAME authenticated SSH connection via the
  existing `shell/exec` channel: `/proc/stat` (delta-based CPU %, per-core),
  `/proc/meminfo` (MemAvailable-based RAM), `df -B1` (root fs), `/proc/net/dev`
  (per-interface throughput), `/proc/uptime`, `/proc/loadavg`, sysinfo
  (hostname, user, kernel, OS, CPU model/count).
- Safe capability probing: a tiny marker `exec` first verifies the backend can
  serve `exec` alongside the PTY AND that output stays out of the terminal
  (xterm buffer leak scan). Otherwise monitoring disables itself — identity and
  actions keep working, no mock values are ever shown.
- Exec output is separated from the PTY stream with per-sample random markers;
  user typing pauses polling (800 ms guard); page-hidden tabs skip ticks;
  5 consecutive failures stop polling.
- Host round-trip latency via `shell/cwd` invoke timing, honestly labeled
  (not ICMP).
- Server details popover (click hostname): server/resource/connection sections,
  CPU sparkline (inline SVG, 30-sample rolling buffer), cached Docker counts.
- Responsive tiers by measured header width (<680px minimal, <1020px reduced)
  via ResizeObserver; xterm fit recalculated after layout changes.
- Settings → Terminal Status Bar: monitoring on/off, compact mode, visible
  metrics, fast (1/2/5s) and slow (5/10/30s) intervals, interface select
  (auto + discovered), warn thresholds, sparkline and popover toggles.
- Interrupt button enabled in PTY mode (sends `^C`); clipboard auto-copy now
  uses the host bridge (`dbxPlugin.copy` → `clipboard.writeText`) because
  `navigator.clipboard` is unavailable in the sandbox; settings persist via
  `host.storage` (new permission) with localStorage fallback.

## 1.0.0 — Fork (2026-10-15)

- Forked `com.nintycat.shell` 0.8.4 UI as `com.robshell` / "My Terminal".
- Auto-copy selected text, 8 terminal themes, font size 9–24px.
- Unsigned `.dbxp`: install with Plugin Center → "Allow unsigned development
  packages" enabled.

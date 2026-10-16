# RShell (net.robrion.robshell v1.3.5)

This release removes background monitor exec from interactive SSH sessions. Metrics use SFTP reads; disk usage stays `N/A` when no isolated collector is available. The user confirmed that cursor blinking/alignment is now working. See `tests/CURSOR-INVESTIGATION.md` for the automated and native-renderer evidence and its limits.

Fork of `com.nintycat.shell` v0.8.4 (NintyShell): local shell and SSH/SFTP
terminals with auto-copy selection, a premium themed terminal, a real-time
**server monitoring status bar**, **next-command suggestions** from your command
history, and **keep-alive + auto-reconnect** that never wipes your scrollback.
No backend rebuild — the original `dbx-plugin-nintyshell` sidecar is reused with
only the identity strings/version patched in place.

## Contents

```
com.robshell/               <- repo folder name (historical)
  package/                  <- plugin source (this is what gets zipped)
    manifest.json           <- id net.robrion.robshell, name RShell, v1.3.4
    checksums.json          <- sha256 of every other file, exactly once
    assets/plugin.ico       <- icon.png artwork, minimized ICO (32 KB)
    bin/windows-x64/dbx-plugin-robshell.exe
    ui/index.html           <- patched UI (chrome + status bar + terminal)
  dist/
    net.robrion.robshell.dbxp  <- installable package (unsigned dev build)
    com.robshell.dbxp          <- byte-identical alias under the historic name
  dbx-plugin.toml           <- project config for `dbx-plugin package` (CLI)
  tests/
    monitor-core.test.js    <- 70 unit tests: metric parsers + reconnect core
    suggest-core.test.js    <- 62 unit tests for the suggestion engine
    theme-core.test.js      <- 445 unit tests for the theme token palettes
    monitor-harness.js      <- headless integration harness (real UI code)
    drv-*.js                <- per-scenario drivers
                               (ok/reject/sftp/sftpdisk/paste/suggest/conn/update/pty)
    ptycap.json               <- real bash transcript (kernel PTY) replayed by drv-pty.js
  CHANGELOG.md
  README.md (this file)
```

## Features

- **Monitoring status bar** (replaces the old header): `🟢 host │ CPU │ RAM │
  Disk │ ↑↓ net │ RTT │ uptime │ ⋯ │ Files Docker Clear Interrupt ⚙`.
  SSH sessions only; local sessions show identity + actions.
- **Real remote data**: CPU (`/proc/stat` deltas + per-core + loadavg), RAM
  (`/proc/meminfo`, MemAvailable-correct), disk (`df -Pk`, POSIX one-line rows,
  root picked by mount, `-P`/`-B1`/`-k` fallbacks), network (`/proc/net/dev`
  deltas, loopback excluded, adaptive KB/s–GB/s), uptime (`/proc/uptime`),
  sysinfo (hostname, user, kernel, OS, CPU model/count). RTT = `shell/cwd`
  bridge round-trip, labeled as such.
- **Safe by design**: one combined `/proc` read per tick on the SAME SSH
  connection (no new connections); probe-then-enable (exec support + xterm
  buffer leak scan); random per-sample markers separate exec output from the
  PTY stream; polling pauses briefly while typing; 5 failures stop polling and
  a watchdog re-arms the timers if samples stall. If the backend can't serve
  exec next to the PTY, the bar uses SFTP file reads for CPU/RAM/net/uptime and
  retries exec for disk — never mock values.
- **Details popover** (click hostname) + **overflow menu** (⋯) + CPU sparkline.
- **Responsive**: full / reduced / minimal tiers from measured header width.
- **Settings → Terminal Status Bar**: on/off, compact mode, visible metrics,
  fast/slow intervals, interface, warn thresholds, sparkline, popover.
- Right-click paste (no selection) + Ctrl+V/Shift+Insert; multi-line paste
  asks for confirmation (configurable threshold). Right-click paste has its own
  Settings toggle.
- **Next-command suggestion** (like `jinpy666/dbx-plugin-ssh`): type the prefix
  of a command you ran before and the rest appears as dim inline text —
  `→` accepts it, `Ctrl+→` one word at a time, `Esc` dismisses. A fuzzy list
  (matched characters highlighted) appears above the input line;
  `Ctrl+↑`/`Ctrl+↓` pick a row, `Tab` fills it, rows are clickable. Plain
  `↑`/`↓` are left alone for the shell's own history. History is captured
  locally (200 entries, persisted) — no new host calls or permissions.
- **Session resilience**:
  - **Auto-reconnect** (on by default): on `shell/pty-closed` or repeated
    `shell/input` rejection, RShell retries the handshake on a bounded
    backoff ladder (0.5→1→2→5 s). The xterm instance is reused, so **the
    scrollback on screen is never cleared**; notes are appended below it.
    Auth/permission/host-key failures are recognised and stop the ladder.
  - **Keep-alive** (opt-in, 1/5/10/30/60 s): keeps an idle NAT/sshd timeout
    from dropping the session using a **silent `shell/cwd` probe** — no bytes
    are ever written to the PTY, so nothing echoes, nothing repaints and no
    phantom line can appear (it is safe inside `vim`/`less` too).
  - Connection-state pill in the toolbar for Reconnecting / Disconnected /
    Authentication failed, plus a "Reconnect now" button in Settings.
- **Prompt integrity** (v1.3.0): RShell never asks the backend for the OSC 7
  `PROMPT_COMMAND` hook, so no internal command is written into the interactive
  PTY, nothing is echoed and your own `PROMPT_COMMAND` is left alone (the file
  panel follows the cwd from the exec meta trailer instead — see
  `CHANGELOG.md` for how the single injection call site was proven).
- **Cursor sync** (v1.3.4): the PTY funnel is byte-lossless — monitor bytes
  never leak into the terminal (a per-tick buffer scan abandons exec for SFTP
  on the first observed leak), Clear is remote-driven (`^L`), `shell/resize`
  is sent only on real geometry changes with a forced re-sync per connect,
  and contended keep-alive probes can't start reconnect storms. Verified by
  replaying a real bash transcript (`tests/ptycap.json`) through the shipped
  pipeline — see `CHANGELOG.md`.
- **Update check** (v1.3.0, keeps watching since v1.3.2): compares its version with the newest release on
  `github.com/robprian/net.robrion.robshell` — silent, cached for 6 h, re-checked
  on an interval for long-lived panels — and
  shows a status-bar badge when a newer one exists; click it to open the
  download page. On/off switch and "Check now" under Settings → Updates.
  RShell cannot install itself: unsigned `.dbxp` packages still go through the
  DBX Plugin Center.
- **Premium terminal**:
  - Theme system with a full 18-token UI palette **and** a complete xterm
    `ITheme` (16 ANSI + 8 bright + cursor + selection) per theme, applied live
    without ever touching the byte stream. Themes: **OpenCode (default)**,
    Tokyo Night, Catppuccin Mocha, Dracula, Nord, Gruvbox Dark, Light. Legacy
    saved keys migrate automatically.
  - **Real dark default.** The OpenCode theme is the neutral near-black palette
    from OpenCode's own default theme — `#0a0a0a` surface, `#030303` bar,
    `#141414`/`#1e1e1e` raised panels, `#eeeeee` text, `#808080` muted,
    `#484848` borders, `#9d7cd8` accent, `#fab283` cursor — with no blue cast,
    and every terminal layer painted the same colour so no lighter surface can
    flash through on a repaint.
  - Coding-font stack (JetBrains Mono → Cascadia Code → Fira Code → Consolas),
    13.5 px default (9–24), line height 1.00–1.80, cursor style + blink,
    configurable scrollback (default 5 000).
  - Clickable URLs, `Ctrl`/`Cmd`+`F` search with match count, context menu
    (Copy/Paste/Select all/Clear display/Search/Settings), floating copy
    toolbar, slim 5–6 px scrollbars, 14–16 px padding, reduced-motion support,
    and a responsive toolbar/overlay layout for tablet and phone.
- Plus v1.0.0: auto-copy selection (host clipboard bridge), settings via
  `host.storage`.

## Install (DBX portable, Windows)

> `Plugin package must have a trusted Ed25519 signature` is expected for any
> non-Store package. Documented dev flow: **Plugin Center → Settings →
> enable "Allow unsigned development packages"**, then install
> `dist/net.robrion.robshell.dbxp`.
> A dev copy is also staged at
> `D:\DBX\data\plugins\net.robrion.robshell\versions\1.3.2\` (restart DBX to
> discover it).

## Build / repack

```bash
cd com.robshell
# edit files under package/, then:
python3 /tmp/opencode/pack_robshell.py --stage
```

`pack_robshell.py` regenerates `package/checksums.json` (sha256 of every other
file, exactly once), writes `dist/net.robrion.robshell.dbxp` as a zip with
`manifest.json` + `checksums.json` at the root and directory entries for
`assets/ bin/ bin/windows-x64/ ui/`, and with `--stage` extracts it to
`data/plugins/net.robrion.robshell/versions/<version>/`. It refuses to pack
`signature.json` / `dbx-plugin.toml`.

Tests (they extract the app script from `ui/index.html` first):

```bash
python3 -c "import re;html=open('package/ui/index.html').read();open('/tmp/opencode/app3.js','w').write(re.findall(r'<script>(.*?)</script>',html,re.S)[-1])"
node tests/monitor-core.test.js    # 70 parser + reconnect unit tests
node tests/suggest-core.test.js    # 62 suggestion unit tests
node tests/theme-core.test.js      # 445 theme token unit tests
node tests/monitor-harness.js both # 210 integration assertions, 9 scenarios
```

The official `dbx-plugin package` CLI was evaluated: it requires
`dbx-plugin.toml` to declare a *buildable* (Rust/Go) backend, which does not
fit a fork reusing a prebuilt sidecar, so packaging here follows the
documented `.dbxp` layout rules directly (manifest at root, checksums cover
every other file exactly once, `bin/windows-x64/`, no symlinks/traversal,
4.7 MB < 512 MiB limit) and is validated accordingly.

## Test report (2026-10-16, v1.3.4)

- `node --check` on the final UI script: pass.
- 70/70 monitor unit tests pass (`tests/monitor-core.test.js`): all metric
  parsers plus the pure reconnect core — backoff ladder
  (`[500,1000,2000,5000]`, clamping), `keepAliveDue` gating (off by default,
  never while a sample is in flight or the alt buffer is active) and failure
  classification (permanent vs inactive vs transient).
- 445/445 theme unit tests pass (`tests/theme-core.test.js`): seven themes, each
  with a complete 18-key UI palette and a complete 21-key xterm terminal palette,
  the OpenCode default asserted value-by-value against the upstream dark palette
  (including that its surface/text greys are channel-neutral, i.e. no blue cast),
  legacy theme-key migration, `--rs-*` custom-property naming for every UI token,
  and the font-stack fallbacks.
- 62/62 suggestion engine unit tests pass (`tests/suggest-core.test.js`):
  query gating, fuzzy ranking/scoring/tie-breaks, prefix-only ghost semantics
  (including control-char rejection), input classification (plain + bracketed
  paste, arrows, control bytes), line model (append/backspace/Ctrl-U/Ctrl-W/
  Enter/multi-line), first-word chunking, highlight run splitting, state machine.
- 210/210 headless integration assertions pass
  (`tests/monitor-harness.js` + `tests/drv-*.js`, real shipped UI code):
  - exec-rejected (6): `N/A` + both-transport error, RTT alive.
  - exec-working (14): probe, hostname, CPU/RAM/net/disk/uptime, a periodic
    refresh (new CPU sample lands), meta-trailer filtering, prompt display,
    zero marker leak.
  - sftp-fallback (8): transport switch, full metrics, disk honestly `N/A`.
  - sftp-disk-recovery (5): disk `N/A` under SFTP, then recovers to a real
    value once the exec channel works — no reconnect.
  - paste (10): line counting, direct single-line paste, confirm modal
    show/OK/Cancel, right-click paste.
  - suggest (57): engine through the exposed API, the real `term.onData`
    handler building the line model, inline ghost rendering + echo-driven
    repositioning, `→`/`Ctrl+→` accept payloads written to the PTY, list
    rendering, `Tab` fill, `Esc` dismissal, Enter → history commit, and both
    Settings toggles.
  - conn (63): theme tokens reach both the chrome (`--rs-*` custom
    properties + `data-rshell-theme`) and the terminal (full ANSI palette) and
    retint live on switch; the context menu builds the right items, disables
    Copy without a selection, closes on Esc, and right-click still pastes when
    the menu is not invoked; search finds/wraps/no-matches and reports the
    count; link detection finds URLs and e-mails with 1-based ranges and
    respects the Links toggle; **keep-alive sends zero `shell/input` payloads**
    (never `" \x7f"`) and probes with exactly one `shell/cwd` that writes
    nothing to the terminal — the regression guard for the blinking-line bug —
    and is safe in the alternate buffer; and the reconnect path re-runs the
    handshake, restores the session, classifies auth failure as terminal (no
    reconnect storm), works from the manual button, honours the auto-reconnect
    toggle — **and never calls `clear()` or emits `\x1b[2J`/`\x1b[3J`**, so the
    scrollback survives.
  - update (31): the release feed is queried once at boot with the GitHub media
    type and an abort signal; a newer tag shows the status-bar badge (and the
    version in Settings), while an equal, older or malformed tag never does; a
    blocked request resolves to an error state without throwing; the switch
    gates the request; and — **the regression guard for this release — no
    `shell/config` call is ever made and no `injectOsc7` flag is ever sent**,
    while `shell/cwd` still drives the handshake and the known cwd.
  - pty (16): **a real bash transcript is replayed byte-for-byte**
    (`tests/ptycap.json`: kernel PTY, readline echo, a multiplexed exec block
    with a real `/proc/stat` payload, `^L` redraw, resize, UTF-8). With a
    flight open the exec block is consumed for metrics while every interactive
    byte lands exactly once — no marker leak, Enter commits exactly once, the
    clear-redraw escape sequence and multibyte UTF-8 survive intact, and no
    phantom trailing newline is appended; with no flight the guard passes the
    same bytes through unchanged. Plus: `shell/resize` is sent only on real
    geometry changes, Clear sends `^L` to the remote (never `term.clear()`),
    and a contended keep-alive probe neither errors nor reconnects.
- Package validation: zip entries correct, `checksums.json` covers every other
  file exactly once (4 files), backend identity consistent
  (`net.robrion.robshell/1.3.4`, providers `com.robshell.shell.connection` /
  `com.robshell.ssh.connection`), plugin-id + version strings patched in the
  sidecar (single `1.3.4` occurrence at the known offset, identity untouched),
  icon re-parsed (6 PNG entries, 32 KB),
  `host.clipboard:read` + `host.network:https://api.github.com` permissions declared.
- Previous release: `v1.3.2` published on `github.com/robprian/net.robrion.robshell` with
  `net.robrion.robshell.dbxp`, its byte-identical alias `com.robrion.robshell.dbxp`,
  and `SHA256SUMS.txt`. The published bytes were
  re-downloaded and hashed back to the validated build,
  and the exact endpoint the plugin calls
  (`/releases/latest`, no auth) returns the new tag with
  `access-control-allow-origin: *`, so the sandboxed `fetch` passes CORS and
  installed v1.3.1 panels show the upgrade badge within 6 h.
- Half-live verification: no DBX/Windows/SSH host exists in this environment,
  so instead of eyeballing a session the exact terminal byte pipeline was
  proven against a real interactive shell — bash under a kernel PTY with
  readline echo — replayed through the shipped code (22/22 pty assertions).
  The SSH transport itself is DBX's closed backend and is out of reach here.
  NOT performed: the real install, real remote metric accuracy, and the
  rendered appearance. If anything still drifts, eval
  `window.__robshell.snapshot()` in devtools and send the JSON — it now also
  includes `termCols`, `termRows`, `execUnsafe` and `execLeaks`, and
  `window.__robshell.update.state()` reports the release check.
- NOT performed live (no DBX, Windows, or SSH host, and no headless browser in
  this environment): the real install, a real SSH session (so the prompt fix is
  proven by binary analysis + regression tests, not by eye), real remote metric
  accuracy, and the rendered terminal/search/context-menu appearance. If a
  metric shows `N/A`, hover it for the reason or eval
  `window.__robshell.snapshot()` in devtools and send the JSON — it now also
  includes `connState`, `reconAttempt` and `keepAliveSecs`, and
  `window.__robshell.update.state()` reports the release check.
- Superseded history: the v1.3.0/v1.3.1 verification notes (binary `pclntab`
  analysis of the single `injectOsc7` call site, first release upload) are kept
  in `CHANGELOG.md` and the git history (`v1.3.0`, `v1.3.1` tags + releases).

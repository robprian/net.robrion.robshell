// Scenario: PTY cursor-sync guards, driven by a REAL kernel-PTY transcript.
//
// tests/ptycap.json was captured from `bash --noprofile --norc -i` running
// under a real pty (python pty module): prompt, typing echo, a multiplexed
// monitor-style exec block (echo + real /proc/stat payload + end marker),
// Ctrl+L redraw, a window resize and UTF-8 bytes — in the original 14 kernel
// chunk boundaries. The driver replays those exact bytes through the REAL app
// pipeline (handleEvent -> monTapChunk -> monPtyGuard -> term.write) and
// asserts:
//
//   * transparency with no flight: every byte reaches the terminal unchanged
//     (no \r\n mangling, no ANSI stripping, no duplicates, no drops);
//   * demux with a flight open: the exec block is consumed for metrics while
//     every interactive byte still lands exactly once, with no phantom
//     trailing newline (the continuous-drift bug);
//   * Enter commits exactly once (the typed echo appears exactly once);
//   * Clear is remote-driven (^L via shell/input, never term.clear());
//   * shell/resize is sent only on real geometry changes;
//   * a contended keep-alive probe never trips the reconnect ladder.
;(async () => {
  const out = [];
  const ok = (n, c) => out.push((c ? "PASS " : "FAIL ") + n);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, timeout, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (fn()) return true; } catch (e) {}
      await sleep(25);
    }
    throw new Error("timeout: " + label);
  }
  const fireBytes = (b64) => __fireEvent({ method: "shell/output", params: { connectionId: "c1", data: b64 } });
  const writesB64 = () => Buffer.from(__writes.join(""), "utf8").toString("base64");
  // Mirror of the app's terminal-side filter (tap block rules + byte-exact
  // finish tail): lines of an exec block are dropped, everything else —
  // including a trailing partial line WITHOUT added newline — is kept.
  function expectedTerminal(full, begin, end) {
    const parts = full.split("\n");
    const tail = parts.pop();
    let inBlock = false, s = "";
    for (const line of parts) {
      if (!inBlock && line.indexOf(begin) >= 0) { inBlock = true; continue; }
      if (inBlock && line.indexOf(end) >= 0) { inBlock = false; continue; }
      if (inBlock) continue;
      s += line + "\n";
    }
    if (tail) {
      if (!inBlock && tail.indexOf(begin) >= 0) { /* swallowed like tap */ }
      else if (inBlock && tail.indexOf(end) >= 0) { /* swallowed like tap */ }
      else if (!inBlock) s += tail;
    }
    return s;
  }
  // Mirror of the permanent guard with no flight: marker lines vanish, and a
  // lone begin line opens a suppression region until its end line (the
  // truncated-stream rule) — exec bytes, never user bytes.
  function expectedGuardOnly(full) {
    const re = /__RM[0-9a-z]{6}[BE]__/;
    const idre = /__RM([0-9a-z]{6})[BE]__/;
    const parts = full.split("\n");
    const tail = parts.pop();
    let s = "", guard = "";
    for (const line of parts) {
      if (guard) {
        if (line.indexOf(guard + "E__") >= 0) guard = "";
        continue;
      }
      const m = line.match(re);
      if (m) {
        const id = (line.match(idre) || [])[1];
        if (id && line.indexOf("__RM" + id + "B__") >= 0 && line.indexOf("__RM" + id + "E__") < 0) guard = "__RM" + id;
        continue;
      }
      s += line + "\n";
    }
    if (tail && !guard && !re.test(tail)) s += tail;
    return s;
  }
  try {
    await waitFor(() => typeof term !== "undefined" && term && ptyMode === true && termReady === true, 6000, "pty ready");
    await sleep(2500); // let the (failing) monitor probe + sftp probe settle
    const bootSizes = __resizeCalls.filter((size) => size.cols === 80 && size.rows === 24);
    ok("pty: initial geometry is propagated exactly once", bootSizes.length === 1);
    ptyHost.clientWidth = 1200;
    ptyHost.clientHeight = 800;

    // ---- backend call tap ----
    let resizeN = 0;
    const inputDatas = [];
    let cwdFail = null;
    const origInvoke = window.dbxPlugin.invoke;
    window.dbxPlugin.invoke = async (m, p) => {
      if (m === "shell/resize") resizeN += 1;
      if (m === "shell/input") inputDatas.push(p && p.data);
      if (m === "shell/cwd" && cwdFail) throw cwdFail;
      return origInvoke(m, p);
    };

    // ---- 1. resize: sent on change, then deduped (boot already sent 80x24) ----
    const r0 = resizeN;
    term.cols = 101; schedulePtyResize(); await sleep(450);
    ok("pty: changed geometry propagates to the backend", resizeN === r0 + 1);
    schedulePtyResize(); await sleep(350);
    schedulePtyResize(); await sleep(350);
    ok("pty: repeated fits are not re-sent (no remote repaint storm)", resizeN === r0 + 1);
    term.cols = 80; schedulePtyResize(); await sleep(450);
    ok("pty: restoring geometry propagates", resizeN === r0 + 2);

    // ---- 2. clear is remote-driven ----
    const cc0 = term.clearCount;
    document.getElementById("btnClear")._listeners.click.forEach((f) => f({}));
    await sleep(300);
    let gotCtrlL = false;
    for (const d of inputDatas) {
      try { if (Buffer.from(d, "base64").toString("utf8") === "\x0c") gotCtrlL = true; } catch (_) {}
    }
    ok("pty: clear sends ^L to the remote shell", gotCtrlL);
    ok("pty: clear never wipes the local viewport", term.clearCount === cc0);

    // ---- 3. contended keep-alive probe ----
    cwdFail = new Error("another command is still running");
    const err0 = recon.errCount;
    reconProbe(); await sleep(300);
    ok("pty: contended probe is not a session error", recon.errCount === err0);
    ok("pty: contended probe does not reconnect", recon.state === "connected");
    cwdFail = null;

    // ---- 4+5. real-transcript replay ----
    if (!__ptycap) {
      out.push("SKIP ptyreal: tests/ptycap.json absent");
    } else {
      const cap = __ptycap;
      const FULL = Buffer.from(cap.all_b64, "base64").toString("utf8");
      const begin = cap.begin, end = cap.end;
      ok("ptyreal: capture has the multiplexed exec block", FULL.indexOf(begin) >= 0 && FULL.indexOf(end) >= 0);

      // 4. flight demux: craft the same flight shape execMon builds.
      const f = {
        begin: begin, end: end, cmd: "grep '^cpu ' /proc/stat",
        buf: "", tail: "", inBlock: false, done: false,
        timer: null, endTimer: null, dec: new TextDecoder(),
        resolve: null, reject: null, resolved: null,
      };
      f.resolve = (val) => { if (f.done) return; f.done = true; clearTimeout(f.timer); if (mon.flight === f) mon.flight = null; f.resolved = val; };
      f.reject = (e) => { if (f.done) return; f.done = true; clearTimeout(f.timer); if (mon.flight === f) mon.flight = null; };
      f.timer = setTimeout(() => f.reject(new Error("timeout")), 15000);
      mon.flight = f;
      for (const ch of cap.chunks) fireBytes(ch.b64);
      await sleep(1000); // end-marker 350ms auto-finish + 150ms guard flush
      clearTimeout(f.timer);
      ok("ptyreal: flight auto-finished on the end marker", mon.flight === null && !!f.resolved);
      const cpuLine = (FULL.match(/^cpu .*/m) || [""])[0];
      // Readline framing ([?2004l) between the echo and the payload is
      // genuinely ambiguous on a shared stream and is consumed with the
      // block; the metric parsers scan for their lines, so what matters is
      // the payload line is intact and no USER bytes were eaten.
      ok("ptyreal: exec payload captured for metrics",
        !!f.resolved && f.resolved.text.indexOf(cpuLine) >= 0 &&
        f.resolved.text.indexOf("echo hello") < 0 &&
        f.resolved.text.indexOf("typed-after") < 0 &&
        f.resolved.text.indexOf("after-resize") < 0);
      const expDemux = expectedTerminal(FULL, begin, end);
      ok("ptyreal: interactive bytes land exactly once, exec bytes never", writesB64() === Buffer.from(expDemux, "utf8").toString("base64"));
      const w = __writes.join("");
      ok("ptyreal: no marker leaked to the terminal", w.indexOf("__RM") < 0);
      ok("ptyreal: enter committed exactly once", (w.match(/echo hello\r\n/g) || []).length === 1);
      ok("ptyreal: clear redraw sequence intact", w.indexOf("\x1b[H\x1b[2J") >= 0);
      ok("ptyreal: multibyte UTF-8 intact", w.indexOf("héllo") >= 0);

      // 5. transparency with no flight: only the guard runs.
      const before = writesB64();
      for (const ch of cap.chunks) fireBytes(ch.b64);
      await sleep(500);
      const expGuard = expectedGuardOnly(FULL);
      const combined = Buffer.from(Buffer.from(before, "base64").toString("utf8") + expGuard, "utf8").toString("base64");
      ok("ptyreal: guard passes real bytes through unchanged", writesB64() === combined);
    }
    // Request/response exec completion must not discard an unfinished PTY prompt.
    monStop();
    window.dbxPlugin.invoke = async (m, p) => {
      if (m === "shell/exec") {
        await sleep(250);
        const markers = p.command.match(/__RM[0-9a-z]{6}[BE]__/g);
        return { output: markers[0] + "\nok\n" + markers[1] + "\n" };
      }
      return origInvoke(m, p);
    };
    let start = __writes.length;
    const request = execMon("printf ok", 2000);
    fireBytes(Buffer.from("prompt$ ").toString("base64"));
    await request;
    fireBytes(Buffer.from("typed").toString("base64"));
    await sleep(250);
    ok("pty: direct exec result preserves prompt and typing in order",
      __writes.slice(start).join("") === "prompt$ typed");

    // A slow, fragmented metric line must stay suppressed past the flush timer.
    start = __writes.length;
    fireBytes(Buffer.from("__RMabc123B__\nmetric-part").toString("base64"));
    await sleep(250);
    fireBytes(Buffer.from("-rest\n__RMabc123E__\nprompt$ ").toString("base64"));
    await sleep(250);
    ok("pty: partial monitor payload never escapes on the flush timer",
      __writes.slice(start).join("") === "prompt$ ");

    start = __writes.length;
    fireBytes(Buffer.from("pending$ ").toString("base64"));
    monStop();
    await sleep(250);
    ok("pty: stopping monitoring preserves a pending prompt",
      __writes.slice(start).join("") === "pending$ ");

    window.dbxPlugin.invoke = async (m, p) => {
      if (m === "shell/exec") return {};
      return origInvoke(m, p);
    };
    const stopped = execMon("printf ok", 2000).then(() => false, () => true);
    const flight = mon.flight;
    monStop();
    ok("pty: stopping monitoring settles its flight", await stopped);
    ok("pty: stopping monitoring cancels its deadline", flight.done && flight.timer._destroyed);
  } catch (e) {
    out.push("FAIL harness: " + (e && e.message) + "\n" + String((e && e.stack) || "").split("\n").slice(0, 6).join("\n"));
  }
  __report(out.join("\n") + "\nSNAP " + JSON.stringify(window.__robshell.snapshot()));
})();

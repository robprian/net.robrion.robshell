;(async () => {
  const out = [];
  const ok = (n, c) => out.push((c ? "PASS " : "FAIL ") + n);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, timeout, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (fn()) return true; } catch (e) {}
      await sleep(50);
    }
    throw new Error("timeout: " + label);
  }
  const NL = String.fromCharCode(10);
  const sendOutput = (text) => __fireEvent({ method: "shell/output", params: { connectionId: "c1", data: Buffer.from(text, "utf8").toString("base64") } });
  async function nextFlight(timeout, label) {
    let lastBegin = nextFlight._last || null;
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const f = mon.flight;
      if (f && f.begin !== lastBegin) { nextFlight._last = f.begin; return f; }
      await sleep(30);
    }
    throw new Error("timeout: " + label);
  }
  // Reply to whatever command the monitor runs next, chosen by the command
  // text (the frontend exposes it as flight.cmd). This keeps the driver
  // independent of the exact order/count of probes.
  let fastN = 0;
  function fastBody() {
    fastN += 1;
    if (fastN === 1) return __fixtures.F1;
    if (fastN === 2) return __fixtures.F2;
    // Monotonically increasing counters so every delta is non-zero.
    const k = fastN;
    return "cpu  " + (150 + 10 * k) + " 0 " + (80 + 5 * k) + " " + (900 + 20 * k) + " 30 0 0 0 0 0\n" +
      "__RM__\nMemTotal:        1740244 kB\nMemFree:          200112 kB\nMemAvailable:   1087620 kB\nBuffers:           48132 kB\nCached:           700220 kB\nSwapTotal:        998396 kB\nSwapFree:         998396 kB\n" +
      "__RN__\nInter-|   Receive  | Transmit\n face |bytes packets|bytes packets\n  eth0: " + (3000 + 1000 * k) + " 30 0 0 0 0 0 0 " + (6000 + 2000 * k) + " 40 0 0 0 0 0 0\n" +
      "__RL__\n0.15 0.10 0.05 1/200 1\n";
  }
  function bodyFor(cmd) {
    cmd = String(cmd || "");
    if (/uptime/.test(cmd)) return __fixtures.UP;
    if (/\bdf\b/.test(cmd)) return __fixtures.DF;
    if (/hostname/.test(cmd)) return __fixtures.SYS;
    if (/meminfo/.test(cmd)) return fastBody();
    return "ok";
  }
  async function serve(label) {
    const f = await nextFlight(12000, label || "flight");
    sendOutput(f.begin + NL + bodyFor(f.cmd) + NL + f.end + NL);
    // The frontend finishes a flight ~350ms after seeing the end marker.
    await sleep(700);
    return f;
  }
  try {
    await waitFor(() => mon.active === true, 5000, "mon active");
    await waitFor(() => !!mon.flight, 5000, "probe flight");
    const begin = mon.flight.begin, end = mon.flight.end;
    nextFlight._last = begin;
    sendOutput(begin.slice(0, 4));
    await sleep(120);
    sendOutput(begin.slice(4) + NL + "ok" + NL + end + NL);
    await sleep(900);
    ok("ok: probe enabled polling", mon.ok === true);
    ok("ok: phase ready", mon.phase === "ready");
    ok("ok: exec transport chosen", mon.transport === "exec");

    await serve("sysinfo");
    ok("ok: hostname shown", connName.textContent === "mail.robrion.net");
    await serve("fast1");
    await serve("disk");
    ok("ok: disk rendered", mDiskV.textContent === "66%");
    await serve("uptime");
    ok("ok: uptime rendered", mUpV.textContent === "20h");

    // Next fast sample (2nd /proc/stat delta) yields a CPU percentage.
    await waitFor(() => !!mon.flight, 12000, "cpu flight");
    await serve("fast2");
    await waitFor(() => /[0-9]/.test(mCpuV.textContent), 3000, "cpu pct");
    ok("ok: cpu pct rendered", /[0-9]/.test(mCpuV.textContent));
    ok("ok: cpu bar moved", parseFloat(mCpuB.style.width) > 0);
    ok("ok: mem rendered", mMemV.textContent.indexOf("/") > 0);
    ok("ok: net rendered", mNetV.textContent.indexOf("↑") === 0);

    // Periodic refresh: another fast tick must land a new CPU sample.
    const before = mon.cpuBuf.length;
    await waitFor(() => !!mon.flight, 12000, "realtime flight");
    await serve("fast3");
    await waitFor(() => mon.cpuBuf.length > before, 3000, "realtime sample");
    ok("ok: realtime refresh (cpu sample grows)", mon.cpuBuf.length > before);

    sendOutput("__DBX_META__s1__ 0 /root" + NL + "user@host:~$ ");
    await sleep(500);
    ok("ok: meta trailer filtered", !__writes.join("").match(/__DBX_META__/));
    ok("ok: prompt still displayed", __writes.join("").indexOf("user@host") >= 0);
    ok("ok: no marker leak to terminal", !__writes.join("").match(/__RM/));
  } catch (e) {
    out.push("FAIL harness: " + (e && e.message));
  }
  __report(out.join("\n") + "\nSNAP " + JSON.stringify(window.__robshell.snapshot()));
})();

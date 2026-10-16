;(async () => {
  // SFTP transport selected (exec probe failed) but the exec channel becomes
  // usable later: disk must recover without a reconnect, everything else keeps
  // flowing over SFTP.
  const out = [];
  const ok = (n, c) => out.push((c ? "PASS " : "FAIL ") + n);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, timeout, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (fn()) return true; } catch (e) {}
      await sleep(40);
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
  try {
    await waitFor(() => mon.transport === "sftp", 15000, "sftp transport");
    ok("sftpdisk: transport sftp", mon.transport === "sftp");
    await waitFor(() => /[0-9]/.test(mCpuV.textContent), 25000, "sftp cpu");
    ok("sftpdisk: cpu via sftp", /[0-9]/.test(mCpuV.textContent));
    ok("sftpdisk: disk N/A before exec", mDiskV.textContent === "N/A");

    // The exec channel comes back.
    __execOk = true;
    mon.sftpDiskTryAt = 0;
    // Freeze the interval timers so this deterministic slow-tick is the only
    // one in flight.
    clearInterval(mon.tFast); mon.tFast = null;
    clearInterval(mon.tSlow); mon.tSlow = null;
    mon.sftpFlight = false;
    const tick = monSlowTick();
    const f = await nextFlight(12000, "disk flight");
    sendOutput(f.begin + NL + __fixtures.DF + NL + f.end + NL);
    await tick;
    await sleep(300);
    ok("sftpdisk: disk recovered via exec", mDiskV.textContent === "66%");
    ok("sftpdisk: no marker leak to terminal", !__writes.join("").match(/__RM/));
  } catch (e) {
    out.push("FAIL harness: " + (e && e.message));
  }
  __report(out.join("\n") + "\nSNAP " + JSON.stringify(window.__robshell.snapshot()));
})();

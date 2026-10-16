;(async () => {
  // An available exec slot is still unsafe beside an interactive PTY.
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
  try {
    await waitFor(() => mon.transport === "sftp", 15000, "sftp transport");
    ok("sftpdisk: transport sftp", mon.transport === "sftp");
    await waitFor(() => /[0-9]/.test(mCpuV.textContent), 25000, "sftp cpu");
    ok("sftpdisk: cpu via sftp", /[0-9]/.test(mCpuV.textContent));
    ok("sftpdisk: disk N/A before exec", mDiskV.textContent === "N/A");

    // A newly available shared exec channel must never be probed for df.
    __execOk = true;
    mon.sftpDiskTryAt = 0;
    // Freeze the interval timers so this deterministic slow-tick is the only
    // one in flight.
    clearInterval(mon.tFast); mon.tFast = null;
    clearInterval(mon.tSlow); mon.tSlow = null;
    mon.sftpFlight = false;
    const calls = __execCalls.length;
    await monSlowTick();
    await monTryUpgradeExec();
    await sleep(300);
    ok("sftpdisk: shared exec is never retried", __execCalls.length === calls && !mon.flight);
    ok("sftpdisk: disk stays honest without isolated collection", mDiskV.textContent === "N/A");
    ok("sftpdisk: no marker leak to terminal", !__writes.join("").match(/__RM/));
  } catch (e) {
    out.push("FAIL harness: " + (e && e.message));
  }
  __report(out.join("\n") + "\nSNAP " + JSON.stringify(window.__robshell.snapshot()));
})();

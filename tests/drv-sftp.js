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
  try {
    await waitFor(() => mon.active === true, 5000, "mon active");
    await waitFor(() => mon.transport === "sftp", 15000, "sftp transport");
    ok("sftp: transport selected", mon.transport === "sftp");
    await waitFor(() => /[0-9]/.test(mCpuV.textContent), 25000, "sftp cpu");
    ok("sftp: cpu pct rendered", /[0-9]/.test(mCpuV.textContent));
    ok("sftp: mem rendered", mMemV.textContent.indexOf("/") > 0);
    ok("sftp: net rendered", mNetV.textContent.indexOf("↑") === 0);
    await waitFor(() => connName.textContent === "mail.robrion.net", 15000, "sftp hostname");
    ok("sftp: hostname shown", connName.textContent === "mail.robrion.net");
    await waitFor(() => mUpV.textContent !== "—" && mUpV.textContent !== "N/A", 15000, "sftp uptime");
    ok("sftp: uptime rendered", mUpV.textContent === "20h");
    ok("sftp: disk N/A without exec", mDiskV.textContent === "N/A");
    ok("sftp: no marker leak to terminal", !__writes.join("").match(/__RM/));
  } catch (e) {
    out.push("FAIL harness: " + (e && e.message));
  }
  __report(out.join("\n") + "\nSNAP " + JSON.stringify(window.__robshell.snapshot()));
})();

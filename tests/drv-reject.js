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
    await sleep(800);
    ok("reject: monitor not ok", mon.ok === false);
    ok("reject: phase error", mon.phase === "error");
    ok("reject: N/A shown", mCpuV.textContent === "N/A");
    ok("reject: error captured", (window.__robshell.snapshot().lastError || "").length > 3);
    ok("reject: both transports reported", /exec:/.test(window.__robshell.snapshot().lastError) && /sftp:/.test(window.__robshell.snapshot().lastError));
    ok("reject: rtt still live", mon.tRtt !== null);
  } catch (e) {
    out.push("FAIL harness: " + (e && e.message));
  }
  __report(out.join("\n") + "\nSNAP " + JSON.stringify(window.__robshell.snapshot()));
})();

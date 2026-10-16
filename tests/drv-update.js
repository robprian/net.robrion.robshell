// Scenario: the GitHub release update check, plus the regression guard for the
// PROMPT_COMMAND bug. Driven through the REAL app scope in the vm sandbox.
//
// Two things are asserted:
//   1. No path (boot, reconnect, keep-alive, RTT tick, settings toggles) ever
//      asks the backend to inject the OSC 7 hook -- that is what used to write
//      `export PROMPT_COMMAND=...` into the interactive PTY and wreck the prompt.
//   2. The update check follows the release feed and never advertises a
//      malformed or older tag as an upgrade.
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
  const el = (id) => document.getElementById(id);
  const fireChange = (id, value) => {
    const e = el(id);
    e.value = value;
    if (typeof value === "boolean") e.checked = value;
    (e._listeners.change || []).forEach((f) => f({}));
  };
  const fireClick = (id) => (el(id)._listeners.click || []).forEach((f) => f({}));

  // Record every backend call before init() gets a chance to make any.
  const inv = [];
  const origInvoke = window.dbxPlugin.invoke;
  window.dbxPlugin.invoke = async (m, p) => { inv.push({ m, p }); return origInvoke(m, p); };

  // Controllable release feed.
  let feed = "available";
  const fetchCalls = [];
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url: String(url), opts: opts || {} });
    if (feed === "fail") throw new Error("blocked by host network policy");
    const tag = { available: "v1.4.0", current: "v1.3.5", older: "v1.2.0", garbage: "nightly-build" }[feed];
    return {
      ok: true,
      status: 200,
      json: async () => ({ tag_name: tag, html_url: "https://github.com/robprian/net.robrion.robshell/releases/tag/" + tag }),
    };
  };

  try {
    ok("update: version constant matches the package", window.__robshell.version === "1.3.5");
    await waitFor(() => typeof term !== "undefined" && term && ptyMode === true && termReady === true, 6000, "pty ready");
    await waitFor(() => window.__robshell.update.state() !== "idle", 4000, "automatic check");

    // --- automatic check on boot -----------------------------------------
    ok("update: the boot check used the release API", fetchCalls.length >= 1 && fetchCalls[0].url === window.__robshell.update.api);
    ok("update: asks for the GitHub media type", String((fetchCalls[0].opts.headers || {}).Accept || "").indexOf("github") >= 0);
    ok("update: aborts instead of hanging", !!fetchCalls[0].opts.signal);
    ok("update: newer release detected", window.__robshell.update.state() === "available");
    ok("update: latest version parsed", window.__robshell.update.latest() === "1.4.0");
    ok("update: page points at the release", window.__robshell.update.page().indexOf("/releases/tag/v1.4.0") > 0);
    ok("update: badge is shown", el("btnUpdate").hidden === false);
    ok("update: badge names the version", String(el("btnUpdate").textContent).indexOf("1.4.0") >= 0);
    ok("update: settings row names the version", String(el("setUpdateStatus").textContent).indexOf("1.4.0") >= 0);

    // --- already current --------------------------------------------------
    feed = "current";
    ok("update: forced check runs", (await window.__robshell.update.check({ force: true })) === "current");
    ok("update: up-to-date state", window.__robshell.update.state() === "current");
    ok("update: badgeless when current", el("btnUpdate").hidden === true);
    ok("update: says up to date", String(el("setUpdateStatus").textContent).indexOf("up to date") >= 0);

    // --- older / malformed tags are never upgrades ------------------------
    feed = "older";
    await window.__robshell.update.check({ force: true });
    ok("update: an older release is not an upgrade", window.__robshell.update.state() === "current");
    feed = "garbage";
    await window.__robshell.update.check({ force: true });
    ok("update: a malformed tag is not an upgrade", window.__robshell.update.state() === "current");
    ok("update: malformed tag never reaches the badge", el("btnUpdate").hidden === true);
    ok("update: version compare is total", window.__robshell.update.cmp("1.3.5", "1.3.5") === 0
      && window.__robshell.update.cmp("1.10.0", "1.9.9") === 1
      && window.__robshell.update.cmp("v1.2.9", "1.3.5") === -1);

    // --- network refused by the host --------------------------------------
    feed = "fail";
    ok("update: a blocked request resolves, never throws", (await window.__robshell.update.check({ force: true })) === "error");
    ok("update: failure is reported in settings", String(el("setUpdateStatus").textContent).indexOf("GitHub") >= 0);
    ok("update: failure hides the badge", el("btnUpdate").hidden === true);
    ok("update: failure is not fatal to the app", typeof window.__robshell.snapshot() === "object");

    // --- the toggle --------------------------------------------------------
    fireChange("setUpdateCheck", false);
    ok("update: toggle off is stored", settings.updateCheck === false);
    const callsBefore = fetchCalls.length;
    const stateBefore = window.__robshell.update.state();
    await window.__robshell.update.check({});
    ok("update: no request while checks are off", fetchCalls.length === callsBefore);
    ok("update: state untouched while off", window.__robshell.update.state() === stateBefore);
    ok("update: off is explained", String(el("setUpdateStatus").textContent).indexOf("off") >= 0);
    fireChange("setUpdateCheck", true);
    await waitFor(() => fetchCalls.length > callsBefore, 2000, "re-enabled check");
    ok("update: re-enabling checks immediately", fetchCalls.length > callsBefore);

    // --- root cause: nothing may ask for the OSC 7 / PROMPT_COMMAND hook ---
    ok("prompt: no shell/config call was ever made", inv.filter((c) => c.m === "shell/config").length === 0);
    ok("prompt: no injectOsc7 flag was ever sent",
      inv.every((c) => !(c.p && (c.p.injectOsc7 === true || c.p.injectOsc7 === false || "injectOsc7" in c.p))));
    ok("prompt: the session handshake still runs", inv.some((c) => c.m === "shell/cwd"));
    ok("prompt: cwd is still known for following", remoteCwd === "/root");
  } catch (e) {
    out.push("FAIL harness: " + (e && e.message) + "\n" + String((e && e.stack) || "").split("\n").slice(0, 6).join("\n"));
  }
  __report(out.join("\n") + "\nSNAP " + JSON.stringify(window.__robshell.snapshot()));
})();

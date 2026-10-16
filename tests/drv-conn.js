// Scenario: RShell theme tokens, context menu, in-terminal search, clickable
// URLs, keep-alive injection and the auto-reconnect ladder. Driven through the
// REAL app scope. The decisive assertion is that a reconnect never clears the
// terminal: the previous scrollback must stay on screen.
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
  const dec = (b64) => { try { return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); } catch (e) { return ""; } };
  const fireChange = (id, value) => {
    const el = document.getElementById(id);
    el.value = value;
    if (typeof value === "boolean") el.checked = value;
    (el._listeners.change || []).forEach((f) => f({}));
  };
  const inputs = [];
  const cwdCalls = { n: 0 };
  const writesText = () => __writes.join("");
  try {
    await waitFor(() => typeof term !== "undefined" && term && ptyMode === true && termReady === true, 5000, "pty ready");
    await sleep(200);

    const snap = () => window.__robshell.snapshot();
    const cls = () => document.getElementById("rsConnState");

    // ---- capture the bridge ----
    const origInvoke = window.dbxPlugin.invoke;
    window.dbxPlugin.invoke = async (m, p) => {
      if (m === "shell/input") inputs.push(dec(p.data));
      if (m === "shell/cwd") cwdCalls.n += 1;
      return origInvoke(m, p);
    };

    // ================= theme tokens =================
    ok("theme: connected after load", snap().connState === "connected");
    const root = document.documentElement;
    ok("theme: data attr set", root.getAttribute("data-rshell-theme") === "hacker");
    ok("theme: --rs-bg token", root.style.getPropertyValue("--rs-bg") === "#080c0a");
    ok("theme: --rs-bg-bar token", root.style.getPropertyValue("--rs-bg-bar") === "#0c120e");
    ok("theme: --rs-scroll-thumb-hover token", root.style.getPropertyValue("--rs-scroll-thumb-hover") !== "");
    ok("theme: full ANSI16 on the terminal", term.options.theme && term.options.theme.red === "#ff8080" && term.options.theme.brightBlack === "#829787" && !!term.options.theme.brightWhite);
    ok("theme: terminal bg matches palette", term.options.theme.background === "#080c0a");
    ok("theme: type metrics applied", term.options.lineHeight === 1.45 && term.options.cursorStyle === "block" && term.options.scrollback === 5000);
    ok("theme: mono font stack", String(term.options.fontFamily).includes("JetBrains Mono"));

    fireChange("setTheme", "dracula");
    ok("theme: switch retints terminal", term.options.theme.blue === "#bd93f9" && term.options.theme.background === "#282a36");
    ok("theme: switch retints chrome", root.style.getPropertyValue("--rs-bg") === "#282a36" && root.getAttribute("data-rshell-theme") === "dracula");
    fireChange("setTheme", "gruvboxDark");
    ok("theme: gruvbox brightRed", term.options.theme.brightRed === "#fb4934");
    fireChange("setTheme", "tokyoNight");
    ok("theme: back to tokyoNight", root.getAttribute("data-rshell-theme") === "tokyoNight");

    // ================= context menu =================
    settings.rightClickPaste = false; // right-click opens the menu instead of pasting
    const ctxEvent = { preventDefault() {}, clientX: 40, clientY: 60, ctrlKey: false };
    (ptyHost._listeners.contextmenu || []).forEach((f) => f(ctxEvent));
    ok("ctx: menu opens when right-click paste is off", rsCtxMenu.hidden === false);
    const itemLabels = rsCtxMenu.children.filter((c) => c.className === "rs-ctx-item").map((c) => c.textContent);
    ok("ctx: has Copy", itemLabels.indexOf("Copy") >= 0);
    ok("ctx: has Paste", itemLabels.indexOf("Paste") >= 0);
    ok("ctx: has Select all", itemLabels.indexOf("Select all") >= 0);
    ok("ctx: has Clear display", itemLabels.indexOf("Clear display") >= 0);
    ok("ctx: has Search", itemLabels.indexOf("Search…") >= 0);
    ok("ctx: has Settings", itemLabels.indexOf("Settings") >= 0);
    ok("ctx: separators present", rsCtxMenu.children.filter((c) => c.className === "rs-ctx-sep").length === 2);
    // copy is disabled without a selection, and enabled with one
    const copyBtn = rsCtxMenu.children.filter((c) => c.className === "rs-ctx-item")[0];
    ok("ctx: Copy disabled with no selection", copyBtn.disabled === true);
    term.selection = "pwd";
    rsCtxOpen(40, 60);
    const copyBtn2 = rsCtxMenu.children.filter((c) => c.className === "rs-ctx-item")[0];
    ok("ctx: Copy enabled with a selection", copyBtn2.disabled === false);
    rsCtxClose();
    ok("ctx: closes", rsCtxMenu.hidden === true);
    // right-click with paste on must paste directly and never open the menu
    settings.rightClickPaste = true;
    term.selection = "";
    window.__setClip("echo hi");
    term.pasted = "";
    (ptyHost._listeners.contextmenu || []).forEach((f) => f({ preventDefault() {}, clientX: 5, clientY: 5 }));
    await sleep(60);
    ok("ctx: right-click still pastes when enabled", term.pasted === "echo hi");
    ok("ctx: menu stayed closed while pasting", rsCtxMenu.hidden === true);

    // ================= search =================
    __setTermLines(["alpha beta gamma", "the beta value", "gamma delta"]);
    rsSearchInput.value = "beta";
    (rsSearchInput._listeners.input || []).forEach((f) => f({}));
    await sleep(200);
    ok("search: finds matches", search.matches.length === 2);
    ok("search: reports position", rsSearchCount.textContent === "2 of 2");
    rsSearchGo(-1);
    ok("search: wraps", search.index >= 0 && search.index < 2);
    rsSearchInput.value = "zzz";
    (rsSearchInput._listeners.input || []).forEach((f) => f({}));
    await sleep(200);
    ok("search: no-match message", rsSearchCount.textContent === "No matches");

    // ================= clickable URLs =================
    __setTermLines(["see https://example.com/a?b=1 for details", "mail me at dev@example.com"]);
    ok("links: provider registered", term._linkProviders.length === 1);
    const grab = (y) => new Promise((resolve) => { let r = null; term._linkProviders[0].provideLinks(y, (l) => { r = l; resolve(r); }); });
    const links1 = await grab(1);
    ok("links: finds the URL", !!links1 && links1.length === 1 && links1[0].text === "https://example.com/a?b=1");
    ok("links: range is 1-based on the row", !!links1 && links1[0].range.start.y === 1 && links1[0].range.start.x === 5);
    const links2 = await grab(2);
    ok("links: finds the email", !!links2 && links2.length === 1 && links2[0].text === "dev@example.com");
    fireChange("setLinks", false);
    let off;
    const p = new Promise((res) => { off = res; });
    term._linkProviders[0].provideLinks(1, (l) => off(l));
    ok("links: disabled yields none", (await p) === undefined);
    fireChange("setLinks", true);

    // ================= keep-alive (silent transport probe) =================
    // Regression: keep-alive used to push " \u007f" into the PTY. The remote line
    // editor echoed the space and erased it, repainting the prompt line — a
    // visible blink, and with readline's cursor bookkeeping off by one it emitted
    // a spurious newline. It must now warm the transport with a request that
    // produces NO terminal output and never write to the PTY again.
    ok("keepalive: off by default", snap().keepAliveSecs === 0);
    inputs.length = 0;
    fireChange("setKeepAlive", "1");
    ok("keepalive: setting stored", snap().keepAliveSecs === 1);
    recon.lastActivity = Date.now(); // simulate fresh activity, then go idle
    await sleep(1400);
    ok("keepalive: zero PTY bytes while idle", inputs.length === 0);
    ok("keepalive: never sends space+DEL", !inputs.some((s) => s === " \u007f" || s.indexOf("\u007f") >= 0));
    // deterministic: one shell/cwd round-trip and nothing else, checked synchronously
    cwdCalls.n = 0;
    const wCount = __writes.length, iCount = inputs.length;
    window.__robshell.keepAlive.probe();
    ok("keepalive: probe is a shell/cwd request", cwdCalls.n === 1);
    ok("keepalive: probe writes nothing to the terminal", __writes.length === wCount);
    ok("keepalive: probe sends nothing to the PTY", inputs.length === iCount);
    ok("keepalive: advertised silent", window.__robshell.keepAlive.silent === true);
    inputs.length = 0;
    fireChange("setKeepAlive", "0");
    recon.lastActivity = Date.now();
    await sleep(1200);
    ok("keepalive: no injection when off", inputs.length === 0);
    // a silent probe is safe even while a full-screen program owns the terminal
    recon.lastActivity = 0;
    term.buffer.active.type = "alternate";
    fireChange("setKeepAlive", "1");
    await sleep(1200);
    ok("keepalive: safe in the alternate buffer", inputs.length === 0);
    term.buffer.active.type = "normal";
    fireChange("setKeepAlive", "0");

    // ================= auto-reconnect =================
    const clearBefore = term.clearCount;
    const cwdBefore = cwdCalls.n;
    const writesLenBefore = __writes.length;
    ok("recon: auto-reconnect on by default", settings.autoReconnect === true);

    __fireEvent({ method: "shell/pty-closed", params: { connectionId: "c1", reason: "connection reset by peer" } });
    ok("recon: state leaves connected", snap().connState !== "connected");
    ok("recon: pill appears", cls().hidden === false);

    // ladder: first rung is 500 ms
    await sleep(900);
    ok("recon: session handshake re-run", cwdCalls.n > cwdBefore);
    ok("recon: restored to connected", snap().connState === "connected");
    ok("recon: pill hidden again", cls().hidden === true);
    ok("recon: scrollback NOT cleared", term.clearCount === clearBefore);
    const added = writesText().slice(writesText().length - 4000);
    ok("recon: no screen-clear escape emitted", !__writes.slice(writesLenBefore).join("").includes("\x1b[2J") && !__writes.slice(writesLenBefore).join("").includes("\x1b[3J"));
    ok("recon: user told the session dropped", added.indexOf("Connection lost") >= 0);
    ok("recon: user told it reconnected", added.indexOf("Connection restored") >= 0);
    ok("recon: notes are dim/coloured, not raw", added.indexOf("\x1b[33m") >= 0 && added.indexOf("\x1b[32m") >= 0);

    // permanent failures must not spin forever
    const cwdBefore2 = cwdCalls.n;
    __fireEvent({ method: "shell/pty-closed", params: { connectionId: "c1", reason: "authentication failed" } });
    await sleep(700);
    ok("recon: auth failure is terminal", snap().connState === "authfailed");
    ok("recon: no reconnect storm on auth failure", cwdCalls.n === cwdBefore2);
    ok("recon: auth failure surfaced in the pill", cls().hidden === false && cls().className === "is-authfailed");

    // manual reconnect from the settings button
    document.getElementById("btnReconnectNow")._listeners.click.forEach((f) => f({}));
    await sleep(500);
    ok("recon: manual reconnect works", snap().connState === "connected");

    // auto-reconnect off keeps the user in control
    fireChange("setAutoReconnect", false);
    const cwdBefore3 = cwdCalls.n;
    __fireEvent({ method: "shell/pty-closed", params: { connectionId: "c1", reason: "connection reset by peer" } });
    await sleep(900);
    ok("recon: disabled leaves state disconnected", snap().connState === "disconnected");
    ok("recon: disabled does not reconnect", cwdCalls.n === cwdBefore3);
    ok("recon: disabled still explains itself", __writes.join("").indexOf("reconnect from the connection list") >= 0);
    fireChange("setAutoReconnect", true);
  } catch (e) {
    out.push("FAIL harness: " + (e && e.message) + "\n" + String(e && e.stack || "").split("\n").slice(0, 6).join("\n"));
  }
  __report(out.join("\n") + "\nSNAP " + JSON.stringify(window.__robshell.snapshot()));
})();

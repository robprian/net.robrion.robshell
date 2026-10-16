;(async () => {
  const out = [];
  const ok = (name, condition) => out.push((condition ? "PASS " : "FAIL ") + name);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const closed = (params) => __fireEvent({ method: "shell/pty-closed", params: { connectionId: "c1", ...params } });
  try {
    for (let n = 0; !termReady && n < 200; n++) await sleep(25);
    await sleep(250);
    const first = __writes.length;
    __fireEvent({ method: "shell/output", params: { connectionId: "c1", data: Buffer.from("fast-echo").toString("base64") } });
    ok("latency: printable echo is queued immediately", __writes.slice(first).join("") === "fast-echo");
    await sleep(200);

    for (const key of "exit\r") term._onData(key);
    const start = __writes.length;
    closed({ reason: "closed" });
    await sleep(900);
    ok("logout: explicit exit ends the session", recon.state === "exited");
    ok("logout: no reconnect ladder or restored message", !recon.timer && !__writes.slice(start).join("").includes("Connection restored"));
    ok("logout: background monitoring stops", !mon.active && !mon.tRtt);

    reconStopTimers();
    await loadSession();
    const original = window.dbxPlugin.invoke;
    let resizeProbes = 0;
    window.dbxPlugin.invoke = async (method, params) => {
      if (method === "shell/resize") { resizeProbes++; throw new Error("PTY is not active"); }
      return original(method, params);
    };
    const before = __writes.length;
    closed({ reason: "connection reset by peer" });
    await sleep(1000);
    ok("reconnect: validates the PTY instead of trusting metadata", resizeProbes > 0);
    ok("reconnect: dead PTY is never reported restored", recon.state !== "connected" && !__writes.slice(before).join("").includes("Connection restored"));
    reconStopTimers();
    window.dbxPlugin.invoke = original;
    await loadSession();
    closed({ reason: "eof", exitCode: 0 });
    await sleep(50);
    ok("logout: clean backend EOF ends without retry", recon.state === "exited" && !recon.timer);
    for (const input of ["logout\r", "\x04"]) {
      await loadSession();
      term._onData(input);
      closed({ reason: "closed" });
      await sleep(30);
      ok(input === "\x04" ? "logout: Ctrl+D stops reconnect" : "logout: logout command stops reconnect", recon.state === "exited" && !recon.timer);
      ok("logout: ended terminal disables input", term.options.disableStdin === true && btnReconnectNow.disabled);
    }
    await loadSession();
    term._onData("echo exit\r");
    closed({ reason: "connection reset by peer" });
    await sleep(900);
    ok("reconnect: ordinary commands containing exit still reconnect", recon.state === "connected");
    reconStopTimers(); monStop();
  } catch (error) { out.push("FAIL session: " + error.message); }
  __report(out.join("\n"));
})();

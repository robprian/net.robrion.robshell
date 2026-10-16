;(async () => {
  const out = [];
  const ok = (name, condition) => out.push((condition ? "PASS " : "FAIL ") + name);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    for (let i = 0; i < 200 && (!termReady || mon.transport !== "sftp"); i++) await sleep(25);
    ok("idle: safe metrics transport starts", mon.ok && mon.transport === "sftp");
    await sleep(250);
    ok("idle: startup probes cannot inject terminal newlines", __writes.length === 0);
    const prompt = "[robby@mail ~]$ ";
    __fireEvent({ method: "shell/output", params: { connectionId: "c1", data: Buffer.from(prompt).toString("base64") } });
    await sleep(200);
    const before = __writes.join("");
    const samples = mon.cpuBuf.length;
    clearInterval(mon.tFast); mon.tFast = null;
    clearInterval(mon.tSlow); mon.tSlow = null;
    for (let i = 0; i < 5; i++) {
      mon.sftpFlight = false;
      mon.sftpDiskTryAt = 0;
      mon.execRetryAt = 0;
      await monFastTick();
      await monSlowTick();
      await monTryUpgradeExec();
      await sleep(20);
    }
    await sleep(200);
    ok("idle: metric refreshes cannot move the prompt", __writes.join("") === before);
    ok("idle: interactive sessions never probe or retry exec", __execCalls.length === 0);
    ok("idle: CPU metrics continue updating", mon.cpuBuf.length > samples);
    ok("idle: RAM, network and uptime remain available", !!mon.mem && !!mon.net && mon.upS > 0);
    ok("idle: unsupported disk usage stays honest", mDiskV.textContent === "N/A");
    const invoke = window.dbxPlugin.invoke;
    window.dbxPlugin.invoke = (method, params) => method === "shell/cwd"
      ? Promise.resolve({ cwd: "/home/robby/project" }) : invoke(method, params);
    await monRttTick();
    ok("idle: quiet metadata probe preserves directory tracking", cwd === "/home/robby/project" && remoteCwd === cwd);
    ok("idle: directory refresh does not write terminal bytes", __writes.join("") === before);
    window.dbxPlugin.invoke = invoke;
    const refused = await execMon("printf unsafe", 1000).then(() => false, () => true);
    ok("idle: collector boundary rejects accidental PTY exec", refused && __execCalls.length === 0 && !mon.flight);
    const inputs = [];
    window.dbxPlugin.invoke = (method, params) => {
      if (method === "shell/input") inputs.push(Buffer.from(params.data, "base64").toString("utf8"));
      return invoke(method, params);
    };
    const keys = "pwd\r\x7f\x03";
    term._onData(keys);
    mon.lastInput = 0;
    await monFastTick();
    ok("idle: Enter, Backspace and Ctrl+C are sent once while metrics refresh", inputs.length === 1 && inputs[0] === keys);
    window.dbxPlugin.invoke = invoke;
    const tui = "\x1b[?1049h\x1b[2J\x1b[Htop\r\n\x1b[?1049l";
    const writeStart = __writes.length;
    __fireEvent({ method: "shell/output", params: { connectionId: "c1", data: Buffer.from(tui).toString("base64") } });
    await sleep(250);
    ok("idle: alternate-screen controls and valid CR/LF remain byte-exact", __writes.slice(writeStart).join("") === tui);
    monStop();
  } catch (error) { out.push("FAIL idle: " + error.message); }
  __report(out.join("\n"));
})();

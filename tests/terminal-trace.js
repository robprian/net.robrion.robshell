// Temporary live diagnostic: run in the affected RobShell iframe's DevTools.
// Printable terminal text is redacted. stop() restores every wrapped function;
// nothing is written to storage, the remote host, or the terminal.
(() => {
  if (typeof term === "undefined" || !term || typeof monPtyGuard !== "function") {
    throw new Error("Select the RobShell iframe execution context first");
  }
  if (window.__robshellCursorTrace) window.__robshellCursorTrace.stop();
  const terminal = term;
  const bridge = window.dbxPlugin;
  const originalWrite = terminal.write;
  const originalGuard = monPtyGuard;
  const originalInvoke = bridge.invoke;
  const startedAt = Date.now();
  const records = [];
  const instanceId = "xterm-" + startedAt.toString(36);
  let stopped = false;
  let writeCount = 0;
  let chunkCount = 0;
  const decode = (data) => typeof data === "string" ? data : new TextDecoder().decode(data);
  const escaped = (data) => JSON.stringify(decode(data).replace(
    /\x1b\[[0-9;:?]*[ -/]*[@-~]|[\s\S]/g,
    (token) => token.length > 1 || /[\x00-\x1f\x7f]/.test(token) ? token : "#"
  ));
  const state = () => {
    const b = terminal.buffer.active;
    const monitorTimers = ["tFast", "tSlow", "tRtt", "tRetry", "tWatch"].filter((key) => mon[key] != null);
    return {
      instanceId, ptySessionId: markerPrefix || null,
      sameTerminal: term === terminal,
      terminalElements: document.querySelectorAll("#ptyHost .xterm").length,
      cursorX: b.cursorX, cursorY: b.cursorY, baseY: b.baseY, viewportY: b.viewportY,
      buffer: b.type, cols: terminal.cols, rows: terminal.rows,
      customCursors: document.querySelectorAll(".rs-cursor").length,
      monitorTimers, monitorTimerCount: monitorTimers.length,
      monitorGeneration: mon.generation, execInFlight: !!mon.flight,
      // The host owns its sockets; its bridge exposes no listener enumeration.
      hostSocketListeners: null,
    };
  };
  const record = (origin, extra = {}) => {
    if (stopped) return;
    const row = { ms: Date.now() - startedAt, origin, ...state(), ...extra };
    records.push(row);
    if (records.length > 2000) records.shift();
    console.debug("[robshell-cursor-trace]", row);
  };
  const write = function(data, callback) {
    writeCount += 1;
    const sequence = writeCount;
    const caller = String(new Error().stack || "").split("\n").slice(2, 6)
      .map((line) => (line.match(/at\s+([\w.$]+)/) || [])[1] || "anonymous");
    record("write", { writeCount, caller, length: typeof data === "string" ? new TextEncoder().encode(data).length : data.byteLength, escaped: escaped(data) });
    return originalWrite.call(this, data, () => {
      record("write-parsed", { writeCount: sequence });
      if (callback) callback();
    });
  };
  const guard = function(bytes) {
    chunkCount += 1;
    record("pty-chunk", { chunkCount, length: bytes.byteLength, escaped: escaped(bytes) });
    return originalGuard(bytes);
  };
  const invoke = function(method, params) {
    if (/^shell\/(cwd|exec|resize)$/.test(method)) record("bridge:" + method);
    return originalInvoke.call(this, method, params);
  };
  terminal.write = write;
  monPtyGuard = guard;
  bridge.invoke = invoke;
  const cursorSubscription = terminal.onCursorMove(() => record("cursor-move"));
  const timer = setInterval(() => record("idle-sample"), 1000);
  const deadline = setTimeout(() => stop(), 5 * 60 * 1000);
  function stop() {
    if (stopped) return;
    record("stop", { writeCount, chunkCount });
    stopped = true;
    clearInterval(timer);
    clearTimeout(deadline);
    cursorSubscription.dispose();
    if (terminal.write === write) terminal.write = originalWrite;
    if (monPtyGuard === guard) monPtyGuard = originalGuard;
    if (bridge.invoke === invoke) bridge.invoke = originalInvoke;
  }
  window.__robshellCursorTrace = {
    stop,
    snapshot: state,
    export: () => JSON.stringify(records),
  };
  record("start");
})();

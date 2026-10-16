const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const calls = [], logs = [], timers = new Set();
let disposed = false;
const term = {
  buffer: { active: { cursorX: 15, cursorY: 0, baseY: 0, viewportY: 0, type: "normal" } },
  cols: 80, rows: 24,
  write(data, callback) { calls.push(data); if (callback) callback(); },
  onCursorMove() { return { dispose() { disposed = true; } }; },
};
const bridge = { invoke(method, params) { return { method, params }; } };
const originalWrite = term.write, originalInvoke = bridge.invoke;
const originalGuard = (bytes) => bytes;
const addTimer = () => { const handle = {}; timers.add(handle); return handle; };
const sandbox = {
  term, monPtyGuard: originalGuard, markerPrefix: "__DBX_META__test-session__ ",
  mon: { generation: 7, tFast: {}, tRtt: {}, flight: null },
  window: { dbxPlugin: bridge }, document: { querySelectorAll: () => [] },
  console: { debug: (...args) => logs.push(args) },
  TextEncoder, TextDecoder, setInterval: addTimer, setTimeout: addTimer,
  clearInterval: (handle) => timers.delete(handle), clearTimeout: (handle) => timers.delete(handle),
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "terminal-trace.js"), "utf8"), sandbox);
const bytes = new TextEncoder().encode("private-password\r\n\x1b[10;2H");
assert.strictEqual(sandbox.monPtyGuard(bytes), bytes);
term.write(bytes);
assert.strictEqual(calls[0], bytes);
assert.strictEqual(calls.length, 1);
bridge.invoke("shell/exec", { command: "private-command" });
const trace = sandbox.window.__robshellCursorTrace;
const output = trace.export();
assert(!output.includes("private-password"));
assert(!output.includes("private-command"));
assert(output.includes("10;2H"));
assert(output.includes('"cursorX":15'));
assert(output.includes('"origin":"write-parsed"'));
assert.strictEqual(trace.snapshot().monitorTimers.length, 2);
trace.stop();
assert.strictEqual(term.write, originalWrite);
assert.strictEqual(bridge.invoke, originalInvoke);
assert.strictEqual(sandbox.monPtyGuard, originalGuard);
assert.strictEqual(timers.size, 0);
assert(disposed);
trace.stop();
console.log("PASS terminal trace: redaction, unchanged bytes, parsed state, timer/subscription cleanup");

// Headless integration harness for RShell monitor pipeline.
// Runs the REAL shipped ui/index.html app script in a vm sandbox with a
// mocked window.dbxPlugin bridge + fake DOM/xterm, then drives scenarios.
//
// Usage: node tests/monitor-harness.js [reject|ok|both]
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const SCENARIO = process.argv[2] || "both";

const STAT1 = "cpu  100 0 50 800 20 0 0 0 0 0\n";
const STAT2 = "cpu  150 0 80 900 30 0 0 0 0 0\n";
const MEM = "MemTotal:        1740244 kB\nMemFree:          200112 kB\nMemAvailable:   1087620 kB\nBuffers:           48132 kB\nCached:           700220 kB\nSwapTotal:        998396 kB\nSwapFree:         998396 kB\n";
const NET1 = "Inter-|   Receive  | Transmit\n face |bytes packets|bytes packets\n  eth0: 1000 10 2000 20\n";
const STAT1FULL = "cpu  100 0 50 800 20 0 0 0 0 0\n";
const STAT2FULL = "cpu  150 0 80 900 30 0 0 0 0 0\n";
const NET1FULL = "Inter-|   Receive  | Transmit\n face |bytes packets errs drop|bytes packets errs drop\n  eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0\n";
const NET2FULL = "Inter-|   Receive  | Transmit\n face |bytes packets errs drop|bytes packets errs drop\n  eth0: 3000 30 0 0 0 0 0 0 6000 40 0 0 0 0 0 0\n";
const NET2 = "Inter-|   Receive  | Transmit\n face |bytes packets|bytes packets\n  eth0: 3000 30 6000 40\n";
const DF = "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/vda1 21474836480 14173392000 7300000000 66% /\n";
const UP = "73500.12 123456.00\n";
const LOAD = "0.15 0.10 0.05 1/200 1\n";
const CPUINFO = "processor\t: 0\nmodel name\t: Intel Xeon\nprocessor\t: 1\nmodel name\t: Intel Xeon\n";
const OSREL = 'PRETTY_NAME="Ubuntu 22.04 LTS"\n';
const KREL = "5.15.0\n";
const HOSTN = "mail.robrion.net\n";
const fsCalls = {};
function fsContent(uri) {
  fsCalls[uri] = (fsCalls[uri] || 0) + 1;
  const n = fsCalls[uri];
  if (uri === "sftp:///proc/stat") {
    const k = n - 1;
    return "cpu  " + (100 + 50 * k) + " 0 " + (50 + 30 * k) + " " + (800 + 100 * k) + " 20 0 0 0 0 0\n";
  }
  if (uri === "sftp:///proc/net/dev") {
    const k = n - 1;
    return "Inter-|   Receive  | Transmit\n face |bytes packets errs drop|bytes packets errs drop\n  eth0: " + (1000 + 2000 * k) + " 10 0 0 0 0 0 0 " + (2000 + 4000 * k) + " 20 0 0 0 0 0 0\n";
  }
  const map = {
    "sftp:///proc/meminfo": MEM, "sftp:///proc/loadavg": LOAD, "sftp:///proc/uptime": UP,
    "sftp:///proc/sys/kernel/hostname": HOSTN, "sftp:///proc/sys/kernel/osrelease": KREL,
    "sftp:///etc/os-release": OSREL, "sftp:///proc/cpuinfo": CPUINFO,
  };
  if (uri in map) return map[uri];
  throw new Error("unexpected sftp path " + uri);
}
const SYS = "H=mail.robrion.net\nU=robby\nK=Linux 5.15.0 x86_64\nO=PRETTY_NAME=\"Ubuntu 22.04 LTS\"\nC=model name\t: Intel Xeon\nN=4\n";

function fastSample(stat, net) {
  return stat + "__RM__\n" + MEM + "__RN__\n" + net + "__RL__\n0.15 0.10 0.05 1/200 1\n";
}

// runScenarioReal patches the placeholder properly (kept outside vm builder for clarity)
function runScenarioReal(mode) {
  return new Promise((resolve) => {
    const writes = [];
    const byId = new Map();
    class FakeEl {
      constructor(tag) {
        this.tagName = tag || "DIV";
        this.textContent = ""; this.title = ""; this.hidden = false;
        this.value = ""; this.checked = false; this.className = "";
        this.style = {
          _p: {},
          setProperty(k, v) { this._p[k] = String(v); },
          getPropertyValue(k) { return this._p[k] || ""; },
          removeProperty(k) { delete this._p[k]; },
        }; this.dataset = {}; this.children = [];
        this._attrs = {};
        this.options = []; this.clientWidth = 800; this.clientHeight = 600;
        this.scrollTop = 0; this.scrollHeight = 0;
        const set = new Set();
        this.classList = {
          add: (...c) => c.forEach((x) => set.add(x)),
          remove: (...c) => c.forEach((x) => set.delete(x)),
          toggle: (c, f) => { (f === undefined ? !set.has(c) : f) ? set.add(c) : set.delete(c); },
          contains: (c) => set.has(c),
        };
      }
      addEventListener(t, f) { this._listeners = this._listeners || {}; (this._listeners[t] = this._listeners[t] || []).push(f); }
      set innerHTML(v) { if (v === "" || v == null) { this.children = []; this.options = []; } this._html = String(v == null ? "" : v); }
      get innerHTML() { return this._html || ""; }
      appendChild(n) { this.children.push(n); if (n && n.tagName === "OPTION") this.options.push(n); return n; }
      append(...ns) { ns.forEach((n) => this.appendChild(n)); }
      prepend(...ns) { this.children.unshift(...ns); }
      insertBefore(n) { this.children.push(n); return n; }
      removeChild(n) { this.children = this.children.filter((x) => x !== n); return n; }
      get firstChild() { return this.children[0] || null; }
      get lastChild() { return this.children[this.children.length - 1] || null; }
      replaceChildren(...ns) { this.children = ns; this.options = ns.filter((n) => n && n.tagName === "OPTION"); }
      remove() {}
      closest() { return null; }
      querySelector() { return null; }
      querySelectorAll() { return []; }
      getBoundingClientRect() { return { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 40 }; }
      setAttribute(k, v) { this._attrs = this._attrs || {}; this._attrs[k] = String(v); }
      getAttribute(k) { return (this._attrs || {})[k] === undefined ? null : this._attrs[k]; }
      focus() {} blur() {} select() {}
      setSelectionRange() {}
      scrollIntoView() {}
    }
    const store = () => {
      const m = new Map();
      return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
    };
    let fireEvent = null;
    const dbxPlugin = {
      ready: Promise.resolve(),
      context: { connectionId: "c1", connectionName: "Shell" },
      locale: "en",
      capabilities: {},
      invoke: async (method, params) => {
        if (method === "shell/cwd") return { kind: "ssh", cwd: "/root", home: "/root", shell: "/bin/bash", sid: "s1" };
        if (method === "shell/exec") {
          if (mode === "ok" || (mode === "sftpdisk" && sandbox.__execOk)) return {};
          throw new Error("not supported in pty mode");
        }
        if (method === "filesystem/read") {
          if (mode !== "sftp" && mode !== "sftpdisk") throw new Error("sftp unavailable");
          if (mode === "sftp" || mode === "sftpdisk" || mode === "ok") {
            try {
              const text = fsContent(params && params.uri);
              return { dataBase64: Buffer.from(text, "utf8").toString("base64") };
            } catch (e) { return { success: false, message: e && e.message }; }
          }
          return { success: false, message: "unexpected" };
        }
        return {};
      },
      onEvent: (fn) => { fireEvent = fn; },
    };
    class FakeTerm {
      constructor(o) {
        this.options = o || {}; this.cols = 80; this.rows = 24;
        this.buffer = { active: { length: 0, getLine: () => undefined } };
        this._linkProviders = []; this.clearCount = 0; this.selection = ""; this.selectAllCount = 0;
      }
      loadAddon() {} open() {} focus() {}
      clear() { this.clearCount += 1; }
      onData(fn) { this._onData = fn; }
      onWriteParsed(fn) { this._onWriteParsed = fn; }
      write(d) { writes.push(typeof d === "string" ? d : new TextDecoder().decode(d)); }
      paste(d) { this.pasted = (this.pasted || "") + String(d); }
      getSelection() { return this.selection; }
      hasSelection() { return !!this.selection; }
      clearSelection() { this.selection = ""; }
      select() { this.selected = true; }
      selectAll() { this.selectAllCount += 1; }
      scrollToLine() {}
      registerLinkProvider(p) { this._linkProviders.push(p); return { dispose() {} }; }
      attachCustomKeyEventHandler(fn) { this._keyHandler = fn; }
    }
    const sandbox = {
      console, performance, TextEncoder, TextDecoder,
      atob, btoa,
      setTimeout, clearTimeout, setInterval, clearInterval,
      requestAnimationFrame: (cb) => setTimeout(cb, 0),
      navigator: { clipboard: { readText: async () => sandbox.__clipText } }, localStorage: store(), sessionStorage: store(),
      Terminal: class extends FakeTerm { constructor(o) { super(o); sandbox.__lastTerm = this; } }, FitAddon: { FitAddon: class { fit() {} } },
      ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
      AbortController: class { constructor() { this.signal = {}; } abort() {} },
      // No network in the sandbox: the update check must degrade, not crash.
      // tests/drv-update.js installs its own fetch to drive the happy paths.
      fetch: null,
      window: null, document: null, Buffer,
      __writes: writes, __mode: mode, __clipText: "",
      __setClip: null,
      __execOk: false,
      __fixtures: null, // set below
      __report: (r) => resolve(r),
    };
    sandbox.window = { dbxPlugin, addEventListener: () => {}, getSelection: () => "" };
    sandbox.window.__setClip = (t) => { sandbox.__clipText = String(t); };
    sandbox.__lastTerm = null;
    sandbox.__setTermLines = (lines) => {
      const t = sandbox.__lastTerm;
      if (!t) return;
      t.buffer.active.length = lines.length;
      t.buffer.active.getLine = (y) => (lines[y] === undefined ? undefined : { translateToString: () => lines[y] });
    };
    sandbox.document = {
      hidden: false, body: new FakeEl("BODY"),
      documentElement: new FakeEl("HTML"),
      getElementById: (id) => { if (!byId.has(id)) byId.set(id, new FakeEl()); return byId.get(id); },
      createElement: (t) => new FakeEl(String(t).toUpperCase()),
      createElementNS: (ns, t) => new FakeEl(String(t).toUpperCase()),
      createDocumentFragment: () => new FakeEl("FRAG"),
      addEventListener: () => {},
      execCommand: () => false,
    };
    const htmlIds = [...fs.readFileSync(path.join(__dirname, "..", "package", "ui", "index.html"), "utf-8").matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    sandbox.__fixtures = {
      SYS: "H=mail.robrion.net\nU=robby\nK=Linux 5.15.0 x86_64\nO=PRETTY_NAME=\"Ubuntu 22.04 LTS\"\nC=model name\t: Intel Xeon\nN=4\n",
      // df -Pk output (1K blocks): root row on /, 66% used.
      DF: "Filesystem     1024-blocks     Used Available Capacity Mounted on\n/dev/vda1          20971520 13841984   7129536      66% /\n",
      UP: "73500.12 123456.00\n",
      F1: "cpu  100 0 50 800 20 0 0 0 0 0\n__RM__\nMemTotal:        1740244 kB\nMemFree:          200112 kB\nMemAvailable:   1087620 kB\nBuffers:           48132 kB\nCached:           700220 kB\nSwapTotal:        998396 kB\nSwapFree:         998396 kB\n__RN__\nInter-|   Receive  | Transmit\n face |bytes packets|bytes packets\n  eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0\n__RL__\n0.15 0.10 0.05 1/200 1\n",
      F2: "cpu  150 0 80 900 30 0 0 0 0 0\n__RM__\nMemTotal:        1740244 kB\nMemFree:          200112 kB\nMemAvailable:   1087620 kB\nBuffers:           48132 kB\nCached:           700220 kB\nSwapTotal:        998396 kB\nSwapFree:         998396 kB\n__RN__\nInter-|   Receive  | Transmit\n face |bytes packets|bytes packets\n  eth0: 3000 30 0 0 0 0 0 0 6000 40 0 0 0 0 0 0\n__RL__\n0.15 0.10 0.05 1/200 1\n",
      SL: "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/vda1 21474836480 14173392000 7300000000 66% /\n__DU__\n73500.12 123456.00\n"
    };
    // Real kernel-PTY transcript (tests/ptycap.json, captured from bash under
    // python pty): prompt, typing echo, a multiplexed exec block, ^L redraw,
    // resize, UTF-8. Absent (e.g. packaged runs) -> the pty driver SKIPs.
    try {
      sandbox.__ptycap = JSON.parse(fs.readFileSync(path.join(__dirname, "ptycap.json"), "utf-8"));
    } catch (_) { sandbox.__ptycap = null; }
    vm.createContext(sandbox);
    const htmlForIds = fs.readFileSync(path.join(__dirname, "..", "package", "ui", "index.html"), "utf-8");
    const hiddenIds = new Set([...htmlForIds.matchAll(/<[^>]*\sid="([^"]+)"[^>]*?(\shidden[\s>])/g)].map((m) => m[1]));
    for (const id of htmlIds) {
      if (!byId.has(id)) byId.set(id, new FakeEl());
      if (hiddenIds.has(id)) byId.get(id).hidden = true;
      sandbox[id] = byId.get(id);
    }
    sandbox.__fireEvent = (...a) => fireEvent(...a);
    const html = fs.readFileSync(path.join(__dirname, "..", "package", "ui", "index.html"), "utf-8");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const app = scripts[scripts.length - 1];
    const fast1 = fastSample(STAT1, NET1);
    const fast2 = fastSample(STAT2, NET2);
    const slowS = DF + "__DU__\n" + UP;
    const driverFiles = { ok: "drv-ok.js", reject: "drv-reject.js", sftp: "drv-sftp.js", paste: "drv-paste.js", sftpdisk: "drv-sftpdisk.js", suggest: "drv-suggest.js", conn: "drv-conn.js", update: "drv-update.js", pty: "drv-pty.js" };
    if (!driverFiles[mode]) throw new Error("unknown mode " + mode + " (debug removed; use ok)");
    const driver = fs.readFileSync(path.join(__dirname, driverFiles[mode]), "utf-8");
    try {
      vm.runInContext(app + driver, sandbox, { timeout: 60000 });
    } catch (e) {
      resolve("FAIL harness crashed: " + (e && e.stack || e.message));
    }
    setTimeout(() => resolve("FAIL harness: no report (hang)"), 55000);
  });
}

(async () => {
  const arg = process.argv[2] || "both";
  const modes = arg === "both" ? ["reject", "ok", "sftp", "sftpdisk", "paste", "suggest", "conn", "update", "pty"] : [arg];
  let failed = 0;
  for (const m of modes) {
    console.log("=== scenario: " + m + " ===");
    const r = await runScenarioReal(m);
    console.log(r || "(no result)");
    if (!r || /FAIL/.test(r)) failed++;
  }
  process.exit(failed ? 1 : 0);
})();

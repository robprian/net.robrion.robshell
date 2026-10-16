// RShell monitor-core tests.
// Run: python3 -c "import re;html=open('../package/ui/index.html').read();open('/tmp/app.js','w').write(re.findall(r'<script>(.*?)</script>',html,re.S)[-1])" && node monitor-core.test.js
// (test extracts the app script to /tmp/opencode/app3.js in this workspace)
const fs = require("fs");
const app = fs.readFileSync("/tmp/opencode/app3.js", "utf-8");
const core = app.split("__MONCORE_BEGIN__*/")[1].split("/*__MONCORE_END__")[0];
eval(core);
let pass = 0, fail = 0;
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; }
  else { fail++; console.log("FAIL", name, "\n  got: ", a, "\n  want:", b); }
}

// --- fixtures: real-ish /proc snapshots ---
const STAT1 = "cpu  100 0 50 800 20 0 0 0 0 0\n";
const STAT2 = "cpu  150 0 80 900 30 0 0 0 0 0\n";
const CORES = "cpu0 10 0 5 400 0 0 0 0 0 0\ncpu1 20 0 8 390 0 0 0 0 0 0\n";
const MEM = "MemTotal:        1740244 kB\nMemFree:          200112 kB\nMemAvailable:   1087620 kB\nBuffers:           48132 kB\nCached:           700220 kB\nSwapTotal:        998396 kB\nSwapFree:         998396 kB\n";
const NET = "Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n  eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0\n    lo: 500 5 0 0 0 0 0 0 500 5 0 0 0 0 0 0\n";
const NET2 = "Inter-|   Receive                                                |  Transmit\n face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n  eth0: 3000 30 0 0 0 0 0 0 6000 40 0 0 0 0 0 0\n    lo: 600 6 0 0 0 0 0 0 600 6 0 0 0 0 0 0\n";
const DF = "Filesystem     1B-blocks      Used  Available Use% Mounted on\n/dev/vda1      21474836480 14173392000 7300000000  66% /\n/dev/vda15       109422592   6000000  103422592   6% /boot/efi\n";
const UP = "73500.12 123456.00\n";
const SYS = "H=mail.robrion.net\nU=robby\nK=Linux 5.15.0 x86_64\nO=PRETTY_NAME=\"Ubuntu 22.04 LTS\"\nC=model name\t: Intel Xeon E5-2680\nN=4\n";

const FAST = STAT1 + "__RM__\n" + MEM + "__RN__\n" + NET + "__RL__\n0.15 0.10 0.05 1/200 12345\n" + CORES;

// cpu
const c1 = monParseCpuLine(STAT1.trim());
eq("cpu total", c1.total, 970); eq("cpu idle", c1.idle, 820);
const c2 = monParseCpuLine(STAT2.trim());
eq("cpu pct", monCpuPct(c1, c2), 42.1);
eq("cpu bad line", monParseCpuLine("bogus"), null);
eq("cpu zero dt", monCpuPct(c1, c1), null);

// fast split
const sp = monSplitFast(FAST);
eq("split stat has cpu", sp.stat.indexOf("cpu  ") >= 0, true);
eq("split mem", sp.mem.indexOf("MemTotal") >= 0, true);
eq("split net", sp.net.indexOf("eth0") >= 0, true);
eq("split load", sp.load, "0.15 0.10 0.05 1/200 12345");
eq("split cores", sp.cores.length, 2);

// mem (Linux-correct: used = total - available)
const m = monParseMeminfo(MEM);
eq("mem total B", m.total, 1740244 * 1024);
eq("mem used B", m.used, (1740244 - 1087620) * 1024);
eq("mem swapFree", m.swapFree, 998396 * 1024);

// net (lo excluded)
const n1 = monParseNetDev(NET);
eq("net ifaces", Object.keys(n1), ["eth0"]);
eq("net rx", n1.eth0.rx, 1000); eq("net tx", n1.eth0.tx, 2000);
const n2 = monParseNetDev(NET2);
const pick = monNetPick(n2, n1, 2000, "auto");
eq("net pick iface", pick.iface, "eth0");
eq("net rx rate", pick.rx, 1000); eq("net tx rate", pick.tx, 2000);
const pickPref = monNetPick(n2, n1, 2000, "eth0");
eq("net pref", pickPref.iface, "eth0");
eq("net no prev", monNetPick(n2, null, 2000, "auto").rx, 0);

// disk (root = /)
const d = monParseDf(DF);
eq("disk root pct", d.root.pct, 66);
eq("disk root mount", d.root.mount, "/");
eq("disk root used", d.root.used, 14173392000);
eq("disk others", d.others.length, 1);

// uptime / sysinfo
eq("uptime", monParseUptime(UP), 73500.12);
const si = monParseSysinfo(SYS);
eq("sys host", si.host, "mail.robrion.net");
eq("sys user", si.user, "robby");
eq("sys kernel", si.kernel, "Linux 5.15.0 x86_64");
eq("sys os", si.os, "Ubuntu 22.04 LTS");
eq("sys cpu", si.cpu, "Intel Xeon E5-2680");
eq("sys count", si.count, "4");

// formatters
eq("fmtBytes G", monFmtBytes(14173392000), "13.20 GB");
eq("fmtShort G", monFmtShort(1087620 * 1024), "1.04G");
eq("fmtShort M", monFmtShort(512 * 1024), "512K");
eq("fmtRate", monFmtRate(1536), "1.5 KB/s");
eq("fmtUp m", monFmtUptime(1500), "25m");
eq("fmtUp h", monFmtUptime(73500), "20h");
eq("fmtUp d", monFmtUptime(200000), "2d 7h");
eq("fmtUp null", monFmtUptime(null), "—");

// sparkline
const pts = monSparkPath([10, 20, 30], 60, 26);
eq("spark pts count", pts.split(" ").length, 3);
eq("spark empty", monSparkPath([], 60, 26), "");

// --- keep-alive + auto-reconnect core (pure) ---
eq("recon ladder", RECON_DELAYS, [500, 1000, 2000, 5000]);
eq("recon delay 0", reconDelay(0), 500);
eq("recon delay 1", reconDelay(1), 1000);
eq("recon delay 2", reconDelay(2), 2000);
eq("recon delay 3", reconDelay(3), 5000);
eq("recon delay clamps high", reconDelay(9), 5000);
eq("recon delay negative", reconDelay(-3), 500);
eq("recon delay NaN", reconDelay(NaN), 500);
eq("recon delay float floors", reconDelay(2.9), 2000);

// keepAliveDue: off by default, never while a program owns stdin
eq("keepalive off when 0 secs", keepAliveDue({ intervalSecs: 0, connected: true, now: 1e12 }), false);
eq("keepalive off when disconnected", keepAliveDue({ intervalSecs: 30, connected: false, now: 1e12 }), false);
eq("keepalive due on first tick", keepAliveDue({ intervalSecs: 30, connected: true, lastActivity: 0, now: 1e12 }), true);
eq("keepalive not due yet", keepAliveDue({ intervalSecs: 30, connected: true, lastActivity: 1e12 - 29000, now: 1e12 }), false);
eq("keepalive due at boundary", keepAliveDue({ intervalSecs: 30, connected: true, lastActivity: 1e12 - 30000, now: 1e12 }), true);
eq("keepalive due past interval", keepAliveDue({ intervalSecs: 30, connected: true, lastActivity: 1e12 - 31000, now: 1e12 }), true);
eq("keepalive held during exec flight", keepAliveDue({ intervalSecs: 1, connected: true, inFlight: true, lastActivity: 0, now: 1e12 }), false);
eq("keepalive held in alt buffer", keepAliveDue({ intervalSecs: 1, connected: true, altBuffer: true, lastActivity: 0, now: 1e12 }), false);
eq("keepalive tolerates no opts", keepAliveDue(), false);

// reconClassify: permanent (do not spin), inactive (manual), transient (retry)
eq("classify auth", reconClassify(new Error("ssh: authentication failed")), "permanent");
eq("classify permission denied", reconClassify("Permission denied (publickey)"), "permanent");
eq("classify host key", reconClassify("Host key verification failed"), "permanent");
eq("classify not connected", reconClassify(new Error("connection not connected")), "inactive");
eq("classify not active", reconClassify("session is not active"), "inactive");
eq("classify expired", reconClassify("token expired"), "inactive");
eq("classify closed", reconClassify("pty closed"), "inactive");
eq("classify socket hangup", reconClassify(new Error("read: connection reset by peer")), "transient");
eq("classify unknown", reconClassify(new Error("boom")), "transient");
eq("classify null", reconClassify(null), "transient");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

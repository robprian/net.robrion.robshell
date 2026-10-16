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
  const clickBtn = (id) => {
    const el = document.getElementById(id);
    (el._listeners.click || []).forEach((f) => f({}));
  };
  try {
    await waitFor(() => mon.active === true, 5000, "mon active");
    await sleep(800);
    ok("paste: countLines 1", window.__robshell.paste.countLines("echo hi") === 1);
    ok("paste: countLines trailing-nl", window.__robshell.paste.countLines("a\nb\n") === 2);
    ok("paste: countLines empty", window.__robshell.paste.countLines("") === 0);
    window.__setClip("echo hello");
    term.pasted = "";
    await pasteToTerminal();
    await sleep(200);
    ok("paste: single-line pasted directly", term.pasted === "echo hello");
    ok("paste: single-line no modal", document.getElementById("modal").hidden === true);
    window.__setClip("l1\nl2\nl3\nl4\nl5\nl6");
    term.pasted = "";
    const pp = pasteToTerminal();
    await waitFor(() => document.getElementById("modal").hidden === false, 3000, "modal shows");
    ok("paste: multi-line shows confirm", document.getElementById("modal").hidden === false);
    clickBtn("modalOk");
    await pp; await sleep(200);
    ok("paste: multi-line pasted after OK", term.pasted === "l1\nl2\nl3\nl4\nl5\nl6");
    ok("paste: modal closed after OK", document.getElementById("modal").hidden === true);
    window.__setClip("x1\nx2\nx3\nx4\nx5\nx6\nx7");
    term.pasted = "";
    const pp2 = pasteToTerminal();
    await waitFor(() => document.getElementById("modal").hidden === false, 3000, "modal shows 2");
    clickBtn("modalCancel");
    await pp2; await sleep(200);
    ok("paste: cancel pastes nothing", term.pasted === "");
    window.__setClip("date");
    term.pasted = "";
    (ptyHost._listeners.contextmenu || []).forEach((f) => f({ preventDefault() {} }));
    await sleep(300);
    ok("paste: right-click pastes", term.pasted === "date");
  } catch (e) {
    out.push("FAIL harness: " + (e && e.message));
  }
  __report(out.join("\n") + "\nSNAP " + JSON.stringify(window.__robshell.snapshot()));
})();

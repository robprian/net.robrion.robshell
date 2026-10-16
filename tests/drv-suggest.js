// Scenario: next-command suggestion (history ghost + fuzzy list) and the
// right-click-paste settings toggle. Driven through the REAL app scope
// (term._onData handler + sugKey + settings listeners).
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
  const dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  const fireChange = (id, checked) => {
    const el = document.getElementById(id);
    el.checked = checked;
    (el._listeners.change || []).forEach((f) => f({}));
  };
  const sent = [];
  try {
    await waitFor(() => typeof term !== "undefined" && term && ptyMode === true, 5000, "pty ready");
    await sleep(300);

    // Capture the bytes the suggestion layer writes to the PTY.
    const origInvoke = window.dbxPlugin.invoke;
    window.dbxPlugin.invoke = async (m, p) => {
      if (m === "shell/input") { sent.push(dec(p.data)); return {}; }
      return origInvoke(m, p);
    };

    const S = window.__robshell.suggest;

    // --- pure engine ---
    S.setHistory(["git status", "git commit -m", "docker ps -a", "ls -la", "systemctl restart nginx"]);
    const r1 = S.search("gst", S.history(), 6);
    ok("suggest: fuzzy finds git status", r1.length > 0 && r1[0].command === "git status");
    ok("suggest: empty query yields nothing", S.search("", S.history(), 6).length === 0);
    ok("suggest: no match yields nothing", S.search("zzzz", S.history(), 6).length === 0);
    ok("suggest: ranked, deduped, capped", S.search("git", S.history(), 6).length === 2);

    const items = S.search("git", S.history(), 6);
    const g = S.pickGhost("git", items);
    ok("suggest: ghost picks prefix extension", !!g && g.command === "git status" && g.remainder === " status");
    ok("suggest: no ghost when line equals command", S.pickGhost("ls -la", S.search("ls -la", S.history(), 6)) === null);

    ok("suggest: classify printable", S.classify("g") === "printable");
    ok("suggest: classify backspace", S.classify("\u007f") === "backspace");
    ok("suggest: classify enter", S.classify("\r") === "newline");
    ok("suggest: classify ctrl-c", S.classify("\u0003") === "interrupt");
    ok("suggest: classify arrow", S.classify("\u001b[C") === "cursorMove");
    ok("suggest: classify bare esc", S.classify("\u001b") === "escape");
    ok("suggest: classify paste opaque", S.classify("a\u001bb") === "opaque");
    ok("suggest: classify plain multi-char paste", S.classify("git status") === "printable");
    ok("suggest: classify bracketed paste", S.classify("\u001b[200~git status\u001b[201~") === "printable");
    ok("suggest: bracketed paste line model", S.applyLine("", "\u001b[200~ls -la\u001b[201~").line === "ls -la");

    let r = S.applyLine("git", " status");
    ok("suggest: applyLine appends", r.line === "git status" && r.submit === null);
    r = S.applyLine("git status", "\r");
    ok("suggest: applyLine submits", r.submit === "git status" && r.line === "");
    r = S.applyLine("abc", "\u007f");
    ok("suggest: applyLine backspace", r.line === "ab");
    r = S.applyLine("git commit x", "\u0017");
    ok("suggest: applyLine ctrl-w drops a word", r.line === "git commit ");
    r = S.applyLine("abc", "\u001b[D");
    ok("suggest: applyLine ignores arrows", r.line === "abc");
    r = S.applyLine("abc", "l1\nl2");
    ok("suggest: applyLine multi-line submit head", r.submit === "abcl1" && r.line === "");

    const hl = S.highlight("git status", [0, 1, 2]);
    ok("suggest: highlight splits hit runs", hl.length === 2 && hl[0].hit === true && hl[0].text === "git" && hl[1].hit === false);
    ok("suggest: firstWord", S.firstWord(" status --short") === " status");

    // --- end to end through the real onData handler ---
    S.setHistory(["git status", "git commit -m", "docker ps -a"]);
    term._onData("g");
    await sleep(80);
    ok("suggest: line model tracks typing", S.line() === "g");
    ok("suggest: overlays created", !!sug.els && !!sug.els.ghost && !!sug.els.box);
    ok("suggest: ghost rendered inline", sug.els.ghost.hidden === false && sug.els.ghost.textContent === "it status");
    ok("suggest: list rendered", sug.els.box.hidden === false && sug.els.box.children.length >= 2);
    term._onData("it");
    await sleep(80);
    ok("suggest: ghost follows prefix", sug.els.ghost.textContent === " status");
    term._onWriteParsed();
    ok("suggest: echo repositions ghost", typeof sug.els.ghost.style.left === "string" && /px$/.test(sug.els.ghost.style.left));
    ok("suggest: echo repositions list", typeof sug.els.box.style.left === "string" && /px$/.test(sug.els.box.style.left));

    // accept whole ghost with ArrowRight
    sent.length = 0;
    const handled = sugKey({ type: "keydown", key: "ArrowRight" });
    await sleep(60);
    ok("suggest: ArrowRight handled", handled === true);
    ok("suggest: ArrowRight types remainder", sent.join("") === " status");
    ok("suggest: line advanced after accept", S.line() === "git status");
    ok("suggest: no ghost once complete", sug.els.ghost.hidden === true);

    // word accept with Ctrl+ArrowRight
    S.setHistory(["git commit -m 'x'"]);
    S.input("\u0003");
    term._onData("g");
    await sleep(60);
    sent.length = 0;
    const wordHandled = sugKey({ type: "keydown", key: "ArrowRight", ctrlKey: true });
    await sleep(80);
    ok("suggest: Ctrl+ArrowRight handled", wordHandled === true);
    ok("suggest: Ctrl+ArrowRight types one word", sent.join("") === "it" && S.line() === "git");

    // plain arrows must keep walking remote history
    ok("suggest: plain ArrowUp not hijacked", sugKey({ type: "keydown", key: "ArrowUp" }) === false);
    ok("suggest: plain ArrowDown not hijacked", sugKey({ type: "keydown", key: "ArrowDown" }) === false);

    // Ctrl+ArrowDown picks a row, Tab fills it
    S.setHistory(["docker ps -a", "git status"]);
    S.input("\u0003");            // Ctrl+C resets the model
    term._onData("dkr");
    await sleep(60);
    ok("suggest: list open for dkr", sug.els.box.hidden === false && sug.items.length >= 1);
    ok("suggest: Ctrl+ArrowDown handled", sugKey({ type: "keydown", key: "ArrowDown", ctrlKey: true }) === true);
    sent.length = 0;
    const tabHandled = sugKey({ type: "keydown", key: "Tab" });
    await sleep(60);
    ok("suggest: Tab fills picked row", tabHandled === true && sent.join("") === "\u0015docker ps -a");
    ok("suggest: line set to filled command", S.line() === "docker ps -a");

    // Escape dismisses and is consumed only while a suggestion is visible
    S.setHistory(["git status"]);
    S.input("\u0003");
    term._onData("git");
    await sleep(60);
    ok("suggest: ghost visible before Esc", sug.els.ghost.hidden === false);
    ok("suggest: Esc consumed when visible", sugKey({ type: "keydown", key: "Escape" }) === true);
    ok("suggest: Esc restores passthrough", sugKey({ type: "keydown", key: "Escape" }) === false);

    // Enter commits the typed line into history and clears the model
    S.setHistory([]);
    S.input("\u0003");
    term._onData("echo hi");
    await sleep(40);
    term._onData("\r");
    await sleep(60);
    ok("suggest: Enter records history", S.history()[0] === "echo hi");
    ok("suggest: line cleared after Enter", S.line() === "");

    // --- settings: suggestion toggle ---
    fireChange("setSuggest", false);
    ok("suggest: toggle stores off", settings.suggestOn === false);
    ok("suggest: toggle hides overlays", sug.els.box.hidden === true && sug.els.ghost.hidden === true);
    term._onData("git");
    await sleep(60);
    ok("suggest: disabled keeps overlays hidden", sug.els.box.hidden === true);
    ok("suggest: disabled lets keys pass", sugKey({ type: "keydown", key: "ArrowRight" }) === false);
    fireChange("setSuggest", true);
    ok("suggest: toggle stores on", settings.suggestOn === true);

    // --- settings: right-click paste toggle ---
    ok("suggest: right-click paste on by default", settings.rightClickPaste === true);
    fireChange("setRightClickPaste", false);
    ok("suggest: toggle stores off", settings.rightClickPaste === false);
    window.__setClip("date");
    term.pasted = "";
    (ptyHost._listeners.contextmenu || []).forEach((f) => f({ preventDefault() {} }));
    await sleep(150);
    ok("suggest: right-click disabled pastes nothing", !term.pasted);
    fireChange("setRightClickPaste", true);
    term.pasted = "";
    (ptyHost._listeners.contextmenu || []).forEach((f) => f({ preventDefault() {} }));
    await sleep(200);
    ok("suggest: right-click enabled pastes again", term.pasted === "date");
  } catch (e) {
    out.push("FAIL harness: " + (e && e.message));
  }
  __report(out.join("\n") + "\nSNAP " + JSON.stringify(window.__robshell.snapshot()));
})();

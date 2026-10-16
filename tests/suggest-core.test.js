// RShell next-command suggestion core tests (pure functions only).
// Run: python3 -c "import re;html=open('../package/ui/index.html').read();open('/tmp/opencode/app3.js','w').write(re.findall(r'<script>(.*?)</script>',html,re.S)[-1])" && node suggest-core.test.js
const fs = require("fs");
const app = fs.readFileSync("/tmp/opencode/app3.js", "utf-8");
const core = app.split("/*__SUGGEST_BEGIN__*/")[1].split("/*__SUGGEST_END__")[0];
eval(core);
let pass = 0, fail = 0;
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; }
  else { fail++; console.log("FAIL", name, "\n  got: ", a, "\n  want:", b); }
}
function ok(name, cond) { eq(name, !!cond, true); }

const HIST = ["git status", "git commit -m", "git push origin main", "docker ps -a", "ls -la", "systemctl restart nginx"];

// --- query gate ---
ok("query: single char ok", sugQueryOk("g"));
ok("query: empty rejected", !sugQueryOk(""));
eq("query: max length rejected", sugQueryOk("x".repeat(SUG_MAX_LENGTH + 1)), false);

// --- scoring / ranking ---
eq("search: exact first", sugSearch("ls -la", HIST, 6)[0].command, "ls -la");
eq("search: acronym", sugSearch("gs", HIST, 6)[0].command, "git status");
ok("search: empty query -> none", sugSearch("", HIST, 6).length === 0);
ok("search: no subsequence -> none", sugSearch("qqq", HIST, 6).length === 0);
ok("search: limit respected", sugSearch("g", HIST, 2).length === 2);
ok("search: dedupes history", sugSearch("git", ["git x", "git x"], 6).length === 1);
eq("search: null history safe", sugSearch("g", null, 6), []);
ok("search: indices point into command", (() => {
  const row = sugSearch("gst", HIST, 6)[0];
  return row.indices.length === 3 && row.indices.map((i) => row.command[i].toLowerCase()).join("") === "gst";
})());
ok("search: recency breaks ties", (() => {
  const rows = sugSearch("gi", ["git a", "git b"], 6);
  return rows[0].command === "git a";
})());

// --- ghost (strict prefix extension only) ---
const items = sugSearch("git", HIST, 6);
const ghost = sugPickGhost("git", items);
eq("ghost: picks a prefix command", ghost.command, "git status");
eq("ghost: remainder", ghost.remainder, " status");
ok("ghost: null when line already exact", sugPickGhost("ls -la", sugSearch("ls -la", HIST, 6)) === null);
ok("ghost: null for fuzzy-only list", sugPickGhost("gst", sugSearch("gst", HIST, 6)) === null);
ok("ghost: skips control-char candidate", (() => {
  const g2 = sugPickGhost("ab", [{ command: "ab\u0007c" }, { command: "abcd" }]);
  return g2 && g2.command === "abcd" && g2.remainder === "cd";
})());
ok("ghost: null when every candidate has control chars", sugPickGhost("ab", [{ command: "ab\u0007c" }]) === null);

// --- classify ---
eq("classify: char", sugClassify("a"), "printable");
eq("classify: space", sugClassify(" "), "printable");
eq("classify: multi-char plain paste", sugClassify("git status"), "printable");
eq("classify: backspace", sugClassify("\u007f"), "backspace");
eq("classify: ctrl-u opaque", sugClassify("\u0015"), "opaque");
eq("classify: enter cr", sugClassify("\r"), "newline");
eq("classify: enter lf", sugClassify("\n"), "newline");
eq("classify: ctrl-c", sugClassify("\u0003"), "interrupt");
eq("classify: bare esc", sugClassify("\u001b"), "escape");
eq("classify: arrow", sugClassify("\u001b[D"), "cursorMove");
eq("classify: home", sugClassify("\u001b[H"), "cursorMove");
eq("classify: delete key", sugClassify("\u001b[3~"), "cursorMove");
eq("classify: mouse report opaque", sugClassify("\u001b[<0;10;5M"), "opaque");
eq("classify: mixed control opaque", sugClassify("ab\u0007"), "opaque");
eq("classify: empty opaque", sugClassify(""), "opaque");
eq("classify: bracketed paste", sugClassify("\u001b[200~ls -la\u001b[201~"), "printable");
eq("classify: bracketed multiline", sugClassify("\u001b[200~a\nb\u001b[201~"), "newline");

// --- line model ---
eq("line: append", sugApplyLine("git", " status").line, "git status");
eq("line: submit", sugApplyLine("git status", "\r"), { line: "", submit: "git status" });
eq("line: submit via lf", sugApplyLine("x", "\n").submit, "x");
eq("line: backspace", sugApplyLine("abc", "\u007f").line, "ab");
eq("line: backspace on empty", sugApplyLine("", "\u007f").line, "");
eq("line: ctrl-u clears", sugApplyLine("abc", "\u0015").line, "");
eq("line: ctrl-c clears", sugApplyLine("abc", "\u0003").line, "");
eq("line: ctrl-w drops word", sugApplyLine("git commit x", "\u0017").line, "git commit ");
eq("line: ctrl-w all", sugApplyLine("single", "\u0017").line, "");
eq("line: arrow ignored", sugApplyLine("abc", "\u001b[C").line, "abc");
eq("line: tab ignored (shell completes)", sugApplyLine("git", "\t").line, "git");
eq("line: control bytes ignored", sugApplyLine("abc", "d\u0007e").line, "abc");
eq("line: bracketed paste content", sugApplyLine("", "\u001b[200~ls -la\u001b[201~").line, "ls -la");
eq("line: paste then submit", sugApplyLine("", "\u001b[200~echo hi\u001b[201~\r").submit, "echo hi");

// --- first word / highlight ---
eq("firstWord: leading space", sugFirstWord(" status --short"), " status");
eq("firstWord: bare word", sugFirstWord("word rest"), "word");
eq("firstWord: empty", sugFirstWord(""), "");
eq("highlight: all hit", sugHighlight("abc", [0, 1, 2]), [{ text: "abc", hit: true }]);
eq("highlight: no hit", sugHighlight("abc", []), [{ text: "abc", hit: false }]);
eq("highlight: split", sugHighlight("git status", [0, 1, 2]), [
  { text: "git", hit: true },
  { text: " status", hit: false }
]);
eq("highlight: interleaved", sugHighlight("abcdef", [0, 2, 4]), [
  { text: "a", hit: true },
  { text: "b", hit: false },
  { text: "c", hit: true },
  { text: "d", hit: false },
  { text: "e", hit: true },
  { text: "f", hit: false }
]);
eq("highlight: empty command", sugHighlight("", [0]), []);

// --- state machine ---
eq("state: printable opens", sugNextState({ hidden: true, cursorAtEnd: false }, "printable"), { hidden: false, cursorAtEnd: true });
eq("state: opaque hides", sugNextState({ hidden: false, cursorAtEnd: true }, "opaque"), { hidden: true, cursorAtEnd: true });
eq("state: arrow leaves hidden", sugNextState({ hidden: true, cursorAtEnd: true }, "cursorMove"), { hidden: true, cursorAtEnd: false });
eq("state: enter resets", sugNextState({ hidden: false, cursorAtEnd: false }, "newline"), { hidden: true, cursorAtEnd: true });
eq("state: escape dismisses", sugNextState({ hidden: false, cursorAtEnd: true }, "escape"), { hidden: true, cursorAtEnd: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

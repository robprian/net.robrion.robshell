// RShell theme-core tests: token completeness + legacy theme-key migration.
// Run: python3 -c "import re;html=open('../package/ui/index.html').read();open('/tmp/opencode/app3.js','w').write(re.findall(r'<script>(.*?)</script>',html,re.S)[-1])" && node theme-core.test.js
const fs = require("fs");
const app = fs.readFileSync("/tmp/opencode/app3.js", "utf-8");

// The theme block is plain data + pure helpers between these two anchors.
// It is evaluated inside an IIFE so its const/function declarations stay put.
const start = app.indexOf("const RS_THEMES = {");
const end = app.indexOf("const settingsDefaults");
if (start < 0 || end < 0 || end <= start) {
  console.error("could not locate the theme block in app3.js");
  process.exit(1);
}
const block = app.slice(start, end);
const RS = eval("(function () {\n" + block + "\n;return { RS_THEMES, THEME_ORDER, THEME_ALIASES, THEMES, themeKey, FONT_STACKS, fontStack, cssVarName };})()");
const { RS_THEMES, THEME_ORDER, THEMES, themeKey, FONT_STACKS, fontStack, cssVarName } = RS;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) pass++;
  else { fail++; console.log("FAIL", name, "\n  got: ", a, "\n  want:", b); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.log("FAIL", name); } }

const UI_KEYS = ["bg", "bgBar", "bgElev", "bgHover", "border", "borderSoft", "fg", "fgMuted",
  "fgFaint", "accent", "accentSoft", "ok", "warn", "crit", "scrollTrack", "scrollThumb",
  "scrollThumbHover", "selBg"];
const TERM_KEYS = ["background", "foreground", "cursor", "cursorAccent", "selectionBackground",
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue",
  "brightMagenta", "brightCyan", "brightWhite"];
const DARK_THEMES = ["hacker", "opencode", "tokyoNight", "catppuccinMocha", "dracula", "nord", "gruvboxDark"];

// --- theme registry shape ---
eq("theme count", THEME_ORDER.length, 8);
eq("seven dark themes", THEME_ORDER.slice(0, 7), DARK_THEMES);
eq("light kept for continuity", THEME_ORDER[7], "light");
eq("default theme first", THEME_ORDER[0], "hacker");
eq("THEMES is the registry", Object.keys(THEMES).length, THEME_ORDER.length);
for (const key of THEME_ORDER) {
  const t = THEMES[key];
  ok(`${key}: object`, !!t && typeof t === "object");
  ok(`${key}: has label`, typeof t.label === "string" && t.label.length > 0);
  ok(`${key}: has dark flag`, typeof t.dark === "boolean");
  ok(`${key}: has ui tokens`, !!t.ui && typeof t.ui === "object");
  ok(`${key}: has term tokens`, !!t.term && typeof t.term === "object");
  for (const k of UI_KEYS) ok(`${key}.ui.${k}`, typeof t.ui[k] === "string" && t.ui[k].length > 0);
  for (const k of TERM_KEYS) ok(`${key}.term.${k}`, typeof t.term[k] === "string" && t.term[k].length > 0);
  eq(`${key}: ui key count`, Object.keys(t.ui).length, UI_KEYS.length);
  eq(`${key}: term key count`, Object.keys(t.term).length, TERM_KEYS.length);
  // legacy flat fields mirror the terminal palette (older call sites read these)
  eq(`${key}: flat background`, t.background, t.term.background);
  eq(`${key}: flat foreground`, t.foreground, t.term.foreground);
  eq(`${key}: flat cursor`, t.cursor, t.term.cursor);
  eq(`${key}: flat selection`, t.selectionBackground, t.term.selectionBackground);
}
for (const key of DARK_THEMES) eq(`${key}: dark`, THEMES[key].dark, true);
eq("light: light", THEMES.light.dark, false);

const luminance = (hex) => {
  const rgb = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
for (const foreground of ["fg", "fgMuted", "fgFaint", "accent", "ok", "warn", "crit"]) {
  for (const background of ["bg", "bgBar", "bgElev"]) {
    const a = luminance(THEMES.hacker.ui[foreground]), b = luminance(THEMES.hacker.ui[background]);
    ok(`hacker: ${foreground} on ${background} meets AA`, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5);
  }
}

// --- canonical palette spot checks (16-colour ANSI, not just background) ---
// OpenCode is the default: verify it really is the neutral near-black palette
// from packages/tui/src/theme/assets/v2/opencode.json (dark mode), not a
// blue-cast approximation.
eq("opencode label", THEMES.opencode.label, "OpenCode");
eq("opencode bg", THEMES.opencode.term.background, "#0a0a0a");
eq("opencode ui bg", THEMES.opencode.ui.bg, "#0a0a0a");
eq("opencode bar is darker", THEMES.opencode.ui.bgBar, "#030303");
eq("opencode fg", THEMES.opencode.term.foreground, "#eeeeee");
eq("opencode border", THEMES.opencode.ui.border, "#484848");
eq("opencode accent", THEMES.opencode.ui.accent, "#9d7cd8");
eq("opencode cursor", THEMES.opencode.term.cursor, "#fab283");
eq("opencode red", THEMES.opencode.term.red, "#e06c75");
eq("opencode green", THEMES.opencode.term.green, "#7fd88f");
eq("opencode yellow", THEMES.opencode.term.yellow, "#f5a742");
eq("opencode blue", THEMES.opencode.term.blue, "#5c9cf5");
eq("opencode magenta", THEMES.opencode.term.magenta, "#9d7cd8");
eq("opencode cyan", THEMES.opencode.term.cyan, "#56b6c2");
eq("opencode white", THEMES.opencode.term.white, "#b5b5b5");
eq("opencode brightBlack", THEMES.opencode.term.brightBlack, "#808080");
eq("opencode brightWhite", THEMES.opencode.term.brightWhite, "#ffffff");
// Neutral means neutral: the surface/text greys have no channel skew, which is
// what makes the palette read as "real dark" instead of blue-cast dark.
for (const [k, hex] of [["bg", "#0a0a0a"], ["bgElev", "#141414"], ["bgHover", "#1e1e1e"], ["fg", "#eeeeee"], ["fgFaint", "#808080"], ["fgMuted", "#b5b5b5"], ["border", "#484848"]]) {
  const h = THEMES.opencode.ui[k];
  eq(`opencode ${k} value`, h, hex);
  eq(`opencode ${k} is neutral`, [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)].filter((p, i, a) => p !== a[0]).length, 0);
}
eq("tokyo red", THEMES.tokyoNight.term.red, "#f7768e");
eq("tokyo brightBlack", THEMES.tokyoNight.term.brightBlack, "#414868");
eq("catppuccin green", THEMES.catppuccinMocha.term.green, "#a6e3a1");
eq("catppuccin bg", THEMES.catppuccinMocha.term.background, "#1e1e2e");
eq("dracula purple", THEMES.dracula.term.blue, "#bd93f9");
eq("dracula brightWhite", THEMES.dracula.term.brightWhite, "#ffffff");
eq("nord cyan", THEMES.nord.term.cyan, "#88c0d0");
eq("nord bg", THEMES.nord.term.background, "#2e3440");
eq("gruvbox brightRed", THEMES.gruvboxDark.term.brightRed, "#fb4934");
eq("gruvbox bg", THEMES.gruvboxDark.term.background, "#282828");

// --- legacy theme-key migration ---
eq("legacy dark -> opencode", themeKey("dark"), "opencode");
eq("legacy oneDark -> tokyoNight", themeKey("oneDark"), "tokyoNight");
eq("legacy monokai -> gruvboxDark", themeKey("monokai"), "gruvboxDark");
eq("legacy solarDark -> nord", themeKey("solarDark"), "nord");
eq("legacy solarLight -> light", themeKey("solarLight"), "light");
eq("existing key passes through", themeKey("dracula"), "dracula");
eq("unknown key -> default", themeKey("nope"), "hacker");
eq("undefined key -> default", themeKey(undefined), "hacker");

// --- css custom-property naming ---
eq("cssVar bg", cssVarName("bg"), "--rs-bg");
eq("cssVar bgBar", cssVarName("bgBar"), "--rs-bg-bar");
eq("cssVar bgElev", cssVarName("bgElev"), "--rs-bg-elev");
eq("cssVar bgHover", cssVarName("bgHover"), "--rs-bg-hover");
eq("cssVar borderSoft", cssVarName("borderSoft"), "--rs-border-soft");
eq("cssVar fgMuted", cssVarName("fgMuted"), "--rs-fg-muted");
eq("cssVar fgFaint", cssVarName("fgFaint"), "--rs-fg-faint");
eq("cssVar accentSoft", cssVarName("accentSoft"), "--rs-accent-soft");
eq("cssVar scrollThumbHover", cssVarName("scrollThumbHover"), "--rs-scroll-thumb-hover");
eq("cssVar selBg", cssVarName("selBg"), "--rs-sel-bg");
// every ui token maps to a --rs-* variable the stylesheet expects
for (const k of UI_KEYS) ok(`cssVar covers ${k}`, cssVarName(k).startsWith("--rs-"));

// --- font stacks ---
ok("font stack has JetBrains Mono", fontStack("jetbrains").includes("JetBrains Mono"));
ok("font stack has Cascadia", fontStack("cascadia").includes("Cascadia Code"));
ok("font stack has Fira Code", fontStack("fira").includes("Fira Code"));
ok("font stack always ends in monospace", fontStack("jetbrains").trim().endsWith("monospace"));
eq("unknown font -> default stack", fontStack("nope"), FONT_STACKS.default);
eq("undefined font -> default stack", fontStack(undefined), FONT_STACKS.default);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

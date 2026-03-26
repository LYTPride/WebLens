#!/usr/bin/env node
/**
 * Monaco sticky scroll + wordWrap（WebLens YAML）：
 * - getBottomForLineNumber(end) 在换行下跨整条逻辑行，使 lastLineRelativePosition 异常变大。
 * - 仅 clamp 到 lineHeight 仍会在「倒数第二行与最后一行 sticky」之间留下一整行高度的空白带。
 * - 当 delta >= lineHeight 时视为换行/视图度量不可靠，强制 lastLineRelativePosition = 0，保持冻结行紧凑。
 */
const fs = require("fs");
const path = require("path");

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "monaco-editor",
  "esm",
  "vs",
  "editor",
  "contrib",
  "stickyScroll",
  "browser",
  "stickyScrollController.js",
);

const newBlock =
  "                        // Word wrap: delta can exceed one lineHeight; capping to lineHeight still leaves a full\n" +
  "                        // blank band between sticky rows. Treat delta>=lineHeight as unreliable and use 0 (WebLens).\n" +
  "                        const _wlStickyDelta = bottomOfEndLine - bottomOfElementAtDepth;\n" +
  "                        lastLineRelativePosition = _wlStickyDelta >= lineHeight ? 0 : Math.max(0, _wlStickyDelta);\n";

const oldClampBlock =
  "                        // Word wrap: getBottomForLineNumber spans the full wrapped block; uncapped delta\n" +
  "                        // blows up sticky widget height. Clamp to one line height (WebLens YAML editor).\n" +
  "                        lastLineRelativePosition = Math.max(0, Math.min(bottomOfEndLine - bottomOfElementAtDepth, lineHeight));\n";

const vanillaLine =
  /^(\s*)lastLineRelativePosition = bottomOfEndLine - bottomOfElementAtDepth;\s*$/m;

function main() {
  if (!fs.existsSync(target)) {
    console.warn("[apply-monaco-sticky-patch] skip: monaco stickyScrollController.js not found");
    process.exit(0);
  }
  let s = fs.readFileSync(target, "utf8");
  if (s.includes("_wlStickyDelta")) {
    return;
  }
  if (s.includes(oldClampBlock)) {
    s = s.replace(oldClampBlock, newBlock);
    fs.writeFileSync(target, s, "utf8");
    console.log("[apply-monaco-sticky-patch] upgraded monaco sticky patch (no blank band between sticky rows)");
    return;
  }
  if (!vanillaLine.test(s)) {
    console.warn(
      "[apply-monaco-sticky-patch] skip: expected line not found (monaco version changed?)",
    );
    process.exit(0);
  }
  s = s.replace(vanillaLine, newBlock);
  fs.writeFileSync(target, s, "utf8");
  console.log("[apply-monaco-sticky-patch] applied monaco sticky scroll + wordWrap fix");
}

main();

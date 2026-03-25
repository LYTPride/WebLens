/** YAML 缩进列数（Tab 计为 4 列，与常见编辑器一致） */
export function countLeadingIndentCols(line: string): number {
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === " ") n += 1;
    else if (c === "\t") n += 4;
    else break;
  }
  return n;
}

/** 从非空缩进行推断缩进单位（各缩进深度的最大公约数，下限 2） */
export function detectYamlIndentUnit(lines: string[]): number {
  const indents: number[] = [];
  for (const line of lines) {
    const n = countLeadingIndentCols(line);
    if (n > 0) indents.push(n);
  }
  if (indents.length === 0) return 2;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  let g = indents[0];
  for (let i = 1; i < indents.length; i++) g = gcd(g, indents[i]);
  return Math.max(g, 2);
}

/**
 * 简单行模型：为每一行计算从根到当前行的 key 路径（仅识别 `key:` 与 `- key:`）。
 * 不解析多文档/复杂 YAML 流，足够做导航上下文；异常结构时降级为就近合法栈。
 */
export function buildYamlKeyPathPerLine(yaml: string, indentUnit: number): string[][] {
  const lines = yaml.split("\n");
  const paths: string[][] = lines.map(() => []);
  type StackEntry = { indentCols: number; key: string };
  const stack: StackEntry[] = [];

  // key: 或 "key": 行
  const keyLineRe = /^([a-zA-Z_][\w.-]*|"[^"]+")\s*:\s*(?:[#]|$)/;
  // 列表项 - key:
  const listKeyRe = /^-\s+([a-zA-Z_][\w.-]*)\s*:\s*(?:[#]|$)/;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, "");
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      paths[i] = stack.map((s) => s.key);
      continue;
    }

    const indentCols = countLeadingIndentCols(raw);
    const content = raw.slice(indentCols);

    while (stack.length > 0 && stack[stack.length - 1].indentCols >= indentCols) {
      stack.pop();
    }

    let key: string | null = null;
    const lm = content.match(listKeyRe);
    if (lm) {
      key = lm[1];
    } else {
      const km = content.match(keyLineRe);
      if (km) {
        let k = km[1];
        if (k.startsWith('"') && k.endsWith('"')) k = k.slice(1, -1);
        key = k;
      }
    }

    if (key) {
      stack.push({ indentCols, key });
    }

    paths[i] = stack.map((s) => s.key);
  }

  return paths;
}

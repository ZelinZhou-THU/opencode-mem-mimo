import { readFileSync, existsSync } from "node:fs";

export interface BudgetedReadResult {
  text: string;
  truncated: boolean;
  totalTokens: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function readBudgeted(filePath: string, budgetTokens: number): BudgetedReadResult | undefined {
  if (!existsSync(filePath)) return undefined;
  const fullText = readFileSync(filePath, "utf-8");
  const totalTokens = estimateTokens(fullText);
  if (totalTokens <= budgetTokens) {
    return { text: fullText, truncated: false, totalTokens };
  }
  const ratio = budgetTokens / totalTokens;
  const truncatedText = fullText.slice(0, Math.floor(fullText.length * ratio * 0.95));
  const lastNewline = truncatedText.lastIndexOf("\n");
  const clean = lastNewline > 0 ? truncatedText.slice(0, lastNewline) : truncatedText;
  const hint =
    `\n\n[Truncated at ~${budgetTokens} tokens. ${filePath} is ~${totalTokens} tokens total. ` +
    `Read("${filePath}") for full content.]`;
  return { text: clean + hint, truncated: true, totalTokens };
}

type Section = {
  header: string;
  italic: string;
  body: string[];
  indexLines: string[];
};

function parseSections(text: string): { preamble: string[]; sections: Section[] } {
  const preamble: string[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;
  let italicSeen = false;

  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { header: line, italic: "", body: [], indexLines: [] };
      italicSeen = false;
      continue;
    }
    if (current) {
      if (!italicSeen && line.startsWith("_") && line.endsWith("_")) {
        current.italic = line;
        italicSeen = true;
        continue;
      }
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push(current);
  return { preamble, sections };
}

export function readBudgetedSectionAware(
  filePath: string,
  budgetTokens: number
): BudgetedReadResult | undefined {
  if (!existsSync(filePath)) return undefined;
  const fullText = readFileSync(filePath, "utf-8");
  const totalTokens = estimateTokens(fullText);
  if (totalTokens <= budgetTokens) {
    return { text: fullText, truncated: false, totalTokens };
  }

  const { preamble, sections } = parseSections(fullText);
  const headerOnlyTokens = estimateTokens(
    [...preamble, ...sections.flatMap((s) => [s.header, s.italic, ...s.indexLines])].join("\n")
  );

  if (headerOnlyTokens >= budgetTokens) {
    const skeleton = [
      ...preamble,
      ...sections.flatMap((s) => [s.header, s.italic, ...s.indexLines, ""]),
    ].join("\n");
    const hint =
      `\n\n[File extremely large (${totalTokens} tokens vs budget ${budgetTokens}). ` +
      `Only structure shown. Read("${filePath}") for full content.]`;
    return { text: skeleton + hint, truncated: true, totalTokens };
  }

  const out: string[] = [...preamble];
  let used = estimateTokens(out.join("\n"));

  for (const sec of sections) {
    const skeletonLines = [sec.header, sec.italic, ...sec.indexLines].filter(Boolean);
    used += estimateTokens(skeletonLines.join("\n"));
    out.push(...skeletonLines);

    const fullBody = sec.body.join("\n");
    const bodyTokens = estimateTokens(fullBody);
    if (used + bodyTokens <= budgetTokens) {
      out.push(fullBody);
      used += bodyTokens;
    } else {
      const remaining = budgetTokens - used;
      if (remaining > 50) {
        const cutLen = Math.floor(fullBody.length * (remaining / bodyTokens) * 0.95);
        out.push(fullBody.slice(0, cutLen));
        used += remaining;
      }
    }
    out.push("");
  }

  const hint =
    `\n\n[Truncated at ~${budgetTokens} tokens. ${filePath} is ~${totalTokens} tokens total. ` +
    `Read("${filePath}") for full content.]`;
  return { text: out.join("\n") + hint, truncated: true, totalTokens };
}

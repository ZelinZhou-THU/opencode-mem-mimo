import { existsSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";

const AGENT_VERSION = "opencode-mem-agent-v1";
const AGENT_VERSION_PATTERN = `<!-- ${AGENT_VERSION} -->`;

const AGENT_FILES = [
  { rel: "agents/dream.md", template: "agents/dream.md" },
  { rel: "agents/distill.md", template: "agents/distill.md" },
  { rel: "commands/dream.md", template: "commands/dream.md" },
  { rel: "commands/distill.md", template: "commands/distill.md" },
];

let _templateDir: string | null = null;

function getTemplateDir(): string | null {
  if (_templateDir) return _templateDir;
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(moduleDir, "templates"),
      join(moduleDir, "..", "templates"),
      join(moduleDir, "..", "..", "templates"),
    ];
    for (const c of candidates) {
      if (existsSync(join(c, "agents", "dream.md"))) {
        _templateDir = c;
        return c;
      }
    }
  } catch (error) {
    log("Template dir resolution error", { error: String(error) });
  }
  return null;
}

function needsUpdate(dest: string, src: string): boolean {
  if (!existsSync(dest)) return true;
  try {
    const destContent = readFileSync(dest, "utf-8");
    if (!destContent.includes(AGENT_VERSION_PATTERN)) return false;
    const srcContent = readFileSync(src, "utf-8");
    return destContent !== srcContent;
  } catch {
    return false;
  }
}

export function ensureAgentsInstalled(): { installed: string[]; updated: string[]; skipped: number } {
  const configDir = join(homedir(), ".config", "opencode");
  const templateDir = getTemplateDir();

  if (!templateDir) {
    return { installed: [], updated: [], skipped: AGENT_FILES.length };
  }

  const installed: string[] = [];
  const updated: string[] = [];

  for (const { rel, template } of AGENT_FILES) {
    const dest = join(configDir, rel);
    const src = join(templateDir, template);

    if (!existsSync(src)) continue;

    try {
      if (!needsUpdate(dest, src)) continue;

      const existedBefore = existsSync(dest);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);

      (existedBefore ? updated : installed).push(rel);
    } catch (error) {
      log("Agent file install error", { rel, error: String(error) });
    }
  }

  return { installed, updated, skipped: AGENT_FILES.length - installed.length - updated.length };
}

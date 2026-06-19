import { existsSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";

const AGENT_VERSION = "opencode-mem-agent-v1";
const AGENT_VERSION_PATTERN = `<!-- ${AGENT_VERSION} -->`;
const AGENTS_MD_VERSION = "opencode-mem-agents-md-v1";
const AGENTS_MD_PATTERN = `<!-- ${AGENTS_MD_VERSION} -->`;

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

/**
 * Install AGENTS.md to the project root for top-level memory priming.
 * Safety: if an AGENTS.md already exists WITHOUT our marker, it is treated as
 * user-authored and is NEVER overwritten. Only files we previously created
 * (containing our marker) are kept in sync with the template.
 */
export function ensureProjectAgentsMd(
  projectRoot: string
): { installed: boolean; updated: boolean; skipped: boolean; reason?: string } {
  if (!projectRoot || !isAbsolute(projectRoot)) {
    return { installed: false, updated: false, skipped: true, reason: "invalid project root" };
  }

  const templateDir = getTemplateDir();
  if (!templateDir) {
    return { installed: false, updated: false, skipped: true, reason: "template dir missing" };
  }

  const src = join(templateDir, "AGENTS.md");
  if (!existsSync(src)) {
    return { installed: false, updated: false, skipped: true, reason: "AGENTS.md template missing" };
  }

  const dest = join(projectRoot, "AGENTS.md");

  try {
    if (!existsSync(dest)) {
      copyFileSync(src, dest);
      return { installed: true, updated: false, skipped: false };
    }

    const destContent = readFileSync(dest, "utf-8");
    if (!destContent.includes(AGENTS_MD_PATTERN)) {
      // User-authored AGENTS.md — never overwrite.
      return { installed: false, updated: false, skipped: true, reason: "user-authored AGENTS.md" };
    }

    const srcContent = readFileSync(src, "utf-8");
    if (destContent === srcContent) {
      return { installed: false, updated: false, skipped: true, reason: "already up to date" };
    }

    copyFileSync(src, dest);
    return { installed: false, updated: true, skipped: false };
  } catch (error) {
    log("AGENTS.md install error", { error: String(error) });
    return { installed: false, updated: false, skipped: true, reason: String(error) };
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

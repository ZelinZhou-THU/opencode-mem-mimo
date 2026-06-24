import { CONFIG } from "../config.js";
import { getUserProfileContext } from "./user-profile/profile-context.js";
import { estimateTokens } from "./budgeted-read.js";
export function formatContextForPrompt(userId, projectMemories) {
    const parts = ["[MEMORY]"];
    if (CONFIG.injectProfile && userId) {
        const profileContext = getUserProfileContext(userId);
        if (profileContext) {
            parts.push("\n" + profileContext);
        }
    }
    const projectResults = projectMemories.results || [];
    if (projectResults.length > 0) {
        parts.push("\nProject Knowledge:");
        projectResults.forEach((mem) => {
            const similarity = Math.round(mem.similarity * 100);
            const content = mem.memory || mem.chunk || "";
            parts.push(`- [${similarity}%] ${content}`);
        });
    }
    if (parts.length === 1) {
        return "";
    }
    return parts.join("\n");
}
export function formatSystemPromptMemory(results, tokenBudget, minSimilarity = 0.65) {
    const filtered = results.filter((r) => r.similarity >= minSimilarity);
    if (filtered.length === 0)
        return "";
    const header = "[Relevant Project Memory]";
    let used = estimateTokens(header);
    const lines = [header, ""];
    for (const r of filtered) {
        const content = r.memory || r.chunk || "";
        if (!content)
            continue;
        const simLabel = `[${Math.round(r.similarity * 100)}%]`;
        const line = `- ${simLabel} ${content}`;
        const lineTokens = estimateTokens(line);
        if (used + lineTokens > tokenBudget)
            break;
        lines.push(line);
        used += lineTokens;
    }
    return lines.length > 2 ? lines.join("\n") : "";
}

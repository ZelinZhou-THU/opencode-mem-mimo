/**
 * Install AGENTS.md to the project root for top-level memory priming.
 * Safety: if an AGENTS.md already exists WITHOUT our marker, it is treated as
 * user-authored and is NEVER overwritten. Only files we previously created
 * (containing our marker) are kept in sync with the template.
 */
export declare function ensureProjectAgentsMd(projectRoot: string): {
    installed: boolean;
    updated: boolean;
    skipped: boolean;
    reason?: string;
};
export declare function ensureAgentsInstalled(): {
    installed: string[];
    updated: string[];
    skipped: number;
};
//# sourceMappingURL=agent-installer.d.ts.map
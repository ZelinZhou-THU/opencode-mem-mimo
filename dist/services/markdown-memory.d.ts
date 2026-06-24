export declare function setProjectDirectory(directory: string): void;
export declare function getProjectMemoryPath(projectDir: string): string;
export declare function getGlobalMemoryPath(): string;
export declare function readMemoryFile(path: string): string;
export declare function writeMemoryFile(path: string, content: string): void;
export declare const MEMORY_TEMPLATE = "# Project Memory\n\n## Rules\n_Project-level rules explicitly stated by the user._\n\n## Architecture Decisions\n_Decision + date + rationale._\n\n## Discovered Knowledge\n_Cross-session durable facts._\n\n## Patterns\n_Repeated problems and solutions._\n\n## Gotchas\n_Easy-to-miss traps._\n";
export interface ReconcileResult {
    indexed: number;
    pruned: number;
    skipped: number;
}
export declare function reconcileMarkdown(directory?: string, containerTag?: string): Promise<ReconcileResult>;
export declare function appendToNotes(directory: string, content: string, metadata?: {
    source?: string;
    timestamp?: number;
}): Promise<void>;
//# sourceMappingURL=markdown-memory.d.ts.map
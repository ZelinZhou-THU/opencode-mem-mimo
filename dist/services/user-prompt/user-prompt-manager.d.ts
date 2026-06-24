export interface UserPrompt {
    id: string;
    sessionId: string;
    messageId: string;
    projectPath: string | null;
    content: string;
    createdAt: number;
    captured: boolean;
    userLearningCaptured: boolean;
    linkedMemoryId: string | null;
}
export declare class UserPromptManager {
    private db;
    private readonly dbPath;
    constructor();
    private initDatabase;
    savePrompt(sessionId: string, messageId: string, projectPath: string, content: string): string;
    getLastUncapturedPrompt(sessionId: string): UserPrompt | null;
    deletePrompt(promptId: string): void;
    markAsCaptured(promptId: string): void;
    claimPrompt(promptId: string): boolean;
    /**
     * Release a previously claimed prompt back to the pending state so it can
     * be retried by a future capture cycle. Used when capture aborts before
     * either successfully writing a memory or explicitly skipping the prompt
     * (e.g. transient network error, missing AI response, plugin restart).
     *
     * Only rows still marked as in-progress (captured = 2) are touched, so
     * concurrent callers that already finished the capture cannot be reverted.
     */
    releaseClaim(promptId: string): boolean;
    countUncapturedPrompts(): number;
    getUncapturedPrompts(limit: number): UserPrompt[];
    markMultipleAsCaptured(promptIds: string[]): void;
    countUnanalyzedForUserLearning(): number;
    getPromptsForUserLearning(limit: number): UserPrompt[];
    markAsUserLearningCaptured(promptId: string): void;
    markMultipleAsUserLearningCaptured(promptIds: string[]): void;
    deleteOldPrompts(cutoffTime: number): {
        deleted: number;
        linkedMemoryIds: string[];
    };
    linkMemoryToPrompt(promptId: string, memoryId: string): void;
    getPromptById(promptId: string): UserPrompt | null;
    getCapturedPrompts(projectPath?: string): UserPrompt[];
    searchPrompts(query: string, projectPath?: string, limit?: number): UserPrompt[];
    getPromptsByIds(ids: string[]): UserPrompt[];
    private rowToPrompt;
}
export declare const userPromptManager: UserPromptManager;
//# sourceMappingURL=user-prompt-manager.d.ts.map
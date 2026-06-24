interface MemoryResultMinimal {
    similarity: number;
    memory?: string;
    chunk?: string;
}
interface MemoriesResponseMinimal {
    results?: MemoryResultMinimal[];
}
export declare function formatContextForPrompt(userId: string | null, projectMemories: MemoriesResponseMinimal): string;
export declare function formatSystemPromptMemory(results: MemoryResultMinimal[], tokenBudget: number, minSimilarity?: number): string;
export {};
//# sourceMappingURL=context.d.ts.map
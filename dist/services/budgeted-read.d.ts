export interface BudgetedReadResult {
    text: string;
    truncated: boolean;
    totalTokens: number;
}
export declare function estimateTokens(text: string): number;
export declare function readBudgeted(filePath: string, budgetTokens: number): BudgetedReadResult | undefined;
export declare function readBudgetedSectionAware(filePath: string, budgetTokens: number): BudgetedReadResult | undefined;
//# sourceMappingURL=budgeted-read.d.ts.map
export interface FtsSearchResult {
    id: string;
    content: string;
    snippet: string;
    bm25Score: number;
}
export declare function initFts(db: any): void;
export declare function rebuildFtsIndex(db: any): void;
export declare function searchFts(db: any, query: string, containerTag: string, limit: number): FtsSearchResult[];
//# sourceMappingURL=fts-search.d.ts.map
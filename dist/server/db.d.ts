export declare const pool: {
    query: (text: string, params?: any[]) => Promise<{
        rows: unknown[];
    }>;
    connect: () => Promise<{
        query: (text: string, params?: any[]) => Promise<{
            rows: unknown[];
        }>;
        release: () => void;
    }>;
};
export declare function initDb(): Promise<void>;

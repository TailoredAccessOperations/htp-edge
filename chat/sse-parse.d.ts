/**
 * Type declarations for public/chat/sse-parse.js
 */

export interface SseParser {
  feed(chunk: string): void;
  flush(): void;
}

export function createSseParser(onEvent: (event: string, data: unknown) => void): SseParser;
/**
 * Type declarations for public/chat/chat-messages.js
 */

export function toWireRole(role: string | undefined | null): 'user' | 'assistant';
export function toWireMessages(thread: Array<{ role: string; text?: string | number; failed?: boolean }> | null | undefined): Array<{ role: 'user' | 'assistant'; content: string }>;
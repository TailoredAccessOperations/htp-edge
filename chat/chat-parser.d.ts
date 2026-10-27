/**
 * Type declarations for public/chat/chat-parser.js
 */

export interface PlanNode {
  id: string;
  type?: string;
  key?: string;
  kind?: string;
  value?: string | number | boolean | null;
  link?: string;
  entries?: PlanNode[];
  items?: PlanNode[];
  rows?: Record<string, unknown>[];
  keys?: string[];
  node?: Node;
  root?: boolean;
  error?: string;
}

export function newId(): string;
export function planJson(parsed: unknown): PlanNode;
export function planXml(raw: string): PlanNode | null;
export function planText(raw: string): PlanNode;
export function apiFailureReason(res: { status?: number; statusText?: string; headers?: { get: (k: string) => string | null } } | null, bodyText: string): string;
export function extractBlocks(text: string): Array<{ kind: 'json' | 'xml'; raw: string }>;
export function detectStructured(text: string): { kind: 'json' | 'xml' | null; raw: string; parsed?: unknown; error?: string };
export function renderNode(plan: PlanNode): HTMLElement | null;
/**
 * HTP /chat — wire-format translation for the message thread.
 *
 * The renderer keeps its own role vocabulary: replies are stored as 'ai',
 * which drives the `msg-ai` CSS class and the YOU / WIRE labels in
 * `chat.js`. The worker, however, only accepts 'user' and 'assistant'
 * (src/chat.js). Sending the internal role straight through meant every turn
 * after the first was rejected with
 * "message needs role user|assistant and non-empty content" — and because the
 * client also pushed the failure text back into the thread as another 'ai'
 * message, the error ratcheted and no later turn could recover.
 *
 * The split is deliberate: renaming the internal role would break four
 * render paths, so the translation belongs here, at the network boundary.
 *
 * Pure logic, no DOM, so it stays node-testable.
 */

/** Internal role -> role accepted by the worker. */
const ROLE_MAP = {
  user: 'user',
  ai: 'assistant',
  assistant: 'assistant',
};

/**
 * Map an internal thread role onto a role the worker accepts.
 * Unknown roles fall back to 'user' so we never emit a value the worker
 * would reject outright.
 */
export function toWireRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_MAP, role) ? ROLE_MAP[role] : 'user';
}

/**
 * Translate a thread into the worker's `messages` array.
 *
 * - 'ai' becomes 'assistant'.
 * - Failed transmissions (`failed: true`) are dropped: they are client-side
 *   error text, not model output, and replaying them teaches the model its
 *   own failure as something it said.
 * - Empty content is dropped, so one bad row cannot fail the whole turn —
 *   the worker rejects the entire request if any single message is empty.
 * - Content is coerced to a string for the same reason.
 *
 * Callers are responsible for capping length (the worker allows 20 messages).
 */
export function toWireMessages(thread) {
  if (!Array.isArray(thread)) return [];
  const out = [];
  for (const m of thread) {
    if (!m || typeof m !== 'object' || m.failed === true) continue;
    const content = typeof m.text === 'string' ? m.text : String(m.text ?? '');
    if (content.length === 0) continue;
    out.push({ role: toWireRole(m.role), content });
  }
  return out;
}

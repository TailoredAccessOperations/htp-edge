/**
 * Minimal incremental SSE parser for /chat/api/ask.
 *
 * Network chunks split at arbitrary byte offsets, so a frame can arrive in
 * pieces and several frames can arrive in one chunk. This holds a buffer and
 * only dispatches complete frames, leaving any trailing partial frame for the
 * next feed.
 */

/** Parse one complete `data:` payload as JSON. Returns undefined when absent. */
function parseData(lines) {
  if (!lines.length) return undefined;
  const joined = lines.join('\n');
  try {
    return JSON.parse(joined);
  } catch {
    return undefined;
  }
}

/**
 * Build a parser that reports `onEvent(event, data)` for each complete frame.
 *
 * @param {(event: string, data: any) => void} onEvent
 */
export function createSseParser(onEvent) {
  let buffer = '';

  const dispatch = (frame) => {
    // A frame is optional comment lines, an `event:` line, and one or more
    // `data:` lines, terminated by a blank line.
    const lines = frame.split('\n');
    let event = 'message';
    const data = [];
    for (const line of lines) {
      if (!line || line.startsWith(':')) continue; // comment / keep-alive
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) {
        // A single leading space after the colon is part of the framing.
        const v = line.slice(5);
        data.push(v.startsWith(' ') ? v.slice(1) : v);
      }
    }
    if (!data.length) return;
    const parsed = parseData(data);
    // Drop frames whose payload will not parse. Handing the caller an
    // `undefined` payload would push the failure downstream, where a `delta`
    // with no `.text` reads as a silent stall rather than a bad frame.
    // A literal `null` payload still parses, so it is not lost here.
    if (parsed === undefined) return;
    onEvent(event, parsed);
  };

  return {
    /** Feed a decoded chunk. Dispatches every complete frame it contains. */
    feed(chunk) {
      if (!chunk) return;
      buffer += chunk;
      let sep;
      // Frames end at a blank line; tolerate both \n\n and \r\n\r\n.
      while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const frame = buffer.slice(0, sep);
        const matched = buffer.slice(sep).match(/^\r?\n\r?\n/);
        buffer = buffer.slice(sep + (matched ? matched[0].length : 2));
        if (frame) dispatch(frame);
      }
    },
    /**
     * Emit any trailing frame not terminated by a blank line. The worker always
     * terminates, but a truncated response should still surface what arrived
     * rather than silently dropping the final tokens.
     */
    flush() {
      const rest = buffer.trim();
      buffer = '';
      if (rest) dispatch(rest);
    },
  };
}

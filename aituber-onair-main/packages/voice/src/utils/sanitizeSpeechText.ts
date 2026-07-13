const PAIRED_TAG_BLOCK = /<([a-z][\w:-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const UNCLOSED_TAG_BLOCK = /<([a-z][\w:-]*)\b[^>]*>[\s\S]*$/i;
const ORPHAN_TAG = /<\/?[a-z][\w:-]*\b[^>]*>/gi;
const CODE_FENCE = /```(?:[a-z0-9_-]+)?/gi;
const ANSI_ESCAPE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI control bytes are the exact input being removed.
  /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|[\[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\x07|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])))/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: C0 control bytes are the exact input being removed.
const C0_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const LEAKED_TERMINAL_FRAGMENT = /\[e~\[/gi;
const TRAILING_CONTROL_GARBAGE =
  /(?:\s*\[(?:[a-z]+[~^`]*|[~^`]+[a-z]*)\[)+\s*$/i;
const STRUCTURED_JSON_FRAGMENT =
  /(?:^|[{,])\s*"(?:text|screenplay|emotion|delivery|motion|gaze|gesture|vocal_tags|pause_after_ms)"\s*:/i;

export function hasUnsafeSpeechArtifacts(input: string): boolean {
  const hasControlCharacter = [...input].some((character) => {
    const code = character.charCodeAt(0);
    return code === 0x1b || code === 0x7f || (code < 0x20 && code !== 9 && code !== 10 && code !== 13);
  });
  return (
    hasControlCharacter ||
    /\[e~\[|<\/?[a-z][\w:-]*\b/i.test(input) ||
    STRUCTURED_JSON_FRAGMENT.test(input)
  );
}

/**
 * Remove model-internal control blocks before text reaches viewers or TTS.
 *
 * The filter is deliberately tag-name agnostic: models may invent new
 * director/reasoning tags, so a denylist would eventually leak another one.
 * Ordinary comparison symbols are preserved because only XML-like names
 * beginning with a letter are treated as tags.
 */
export function sanitizeSpeechText(input: string): string {
  let text = input;
  let previous = '';

  const jsonCandidate = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  if (jsonCandidate.startsWith('{')) {
    try {
      const parsed = JSON.parse(jsonCandidate) as {
        text?: unknown;
        screenplay?: { text?: unknown };
      };
      const viewerText =
        typeof parsed.text === 'string'
          ? parsed.text
          : typeof parsed.screenplay?.text === 'string'
            ? parsed.screenplay.text
            : undefined;
      if (viewerText !== undefined) text = viewerText;
    } catch {
      // The residual detector rejects malformed structured envelopes later.
    }
  }

  // Repeat so nested XML-like blocks are removed from the inside out.
  while (text !== previous) {
    previous = text;
    text = text.replace(PAIRED_TAG_BLOCK, ' ');
  }

  // Streaming responses may expose an opening internal tag before its closing
  // tag arrives. Suppress everything from that opening tag onward.
  text = text.replace(UNCLOSED_TAG_BLOCK, ' ');
  text = text.replace(ORPHAN_TAG, ' ');
  text = text.replace(CODE_FENCE, ' ');
  text = text.replace(ANSI_ESCAPE, ' ');
  text = text.replace(C0_CONTROL, ' ');

  // Terminal fragments can be repeated hundreds of times after a polluted
  // response is fed back into conversation memory. Remove every known leaked
  // fragment, then repeatedly strip any generic trailing chain until stable.
  text = text.replace(LEAKED_TERMINAL_FRAGMENT, ' ');
  do {
    previous = text;
    text = text.replace(TRAILING_CONTROL_GARBAGE, ' ');
  } while (text !== previous);

  return text.replace(/\s+/g, ' ').trim();
}

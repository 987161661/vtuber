export type ConversationRelevance = 'semantic' | 'continuation' | 'none';

const CONTINUITY_REFERENCE =
  /(?:你那边|上次|之前|刚才|方才|上一条|前面|还记得|那件事|继续|怎么回事|什么意思)|^(?:这(?:个|句|条|事|不|也|就|还|又|才|么)|那(?:个|句|条|事|你|我|他|她|它|就|还|又)|他|她|它)|(?:因为|所以|但是|可是?)(?:他|她|它)/u;
const SHORT_REACTION =
  /^(?:[?？!！。，、…~～]+|哈哈哈*|呵呵|行吧?|好吧?|对|不是|算了|可以|我去|来了|真的|然后呢|所以呢)$/u;
const TOKEN_STOP_CHARS = new Set(
  Array.from('我你他她它的是了在有和就都还又再这那只个会不别说提聊事次上过里啊呀吗呢吧真想看听感让能到被给跟很太多少好来去也把对着'),
);

function messageBody(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/^.{0,80}?的弹幕[：:]\s*/u, '')
    .trim();
}

function relevanceTokens(text: string): Set<string> {
  const normalized = messageBody(text)
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, '');
  const characters = Array.from(normalized);
  const tokens = new Set<string>();
  for (let index = 0; index < characters.length - 1; index += 1) {
    tokens.add(`${characters[index]}${characters[index + 1]}`);
  }
  for (const character of characters) {
    if (
      /[\p{Script=Han}a-z0-9]/u.test(character) &&
      !TOKEN_STOP_CHARS.has(character)
    ) {
      tokens.add(character);
    }
  }
  return tokens;
}

/**
 * Classify whether an earlier utterance is useful for the current turn. The
 * caller decides how many continuation turns to admit; semantic matches are
 * safe to retrieve directly, while continuation references need a tight
 * recency window.
 */
export function classifyConversationRelevance(
  input: string,
  candidate: string,
): ConversationRelevance {
  const body = messageBody(input);
  if (CONTINUITY_REFERENCE.test(body) || SHORT_REACTION.test(body)) {
    return 'continuation';
  }
  const inputTokens = relevanceTokens(body);
  const candidateTokens = relevanceTokens(candidate);
  return [...inputTokens].some((token) => candidateTokens.has(token))
    ? 'semantic'
    : 'none';
}

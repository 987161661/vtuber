function viewerPrefix(viewerName?: string): string {
  const normalized = viewerName?.replace(/^@+/u, '').trim().slice(0, 40);
  return normalized ? `@${normalized}，` : '';
}

/**
 * Last-resort spoken reply for an ordinary companion turn when every model
 * provider is unavailable. It only acknowledges viewer-supplied information
 * and never manufactures an answer or a weather fact.
 */
export function buildCompanionGenerationFallback(input: {
  text: string;
  viewerName?: string;
}): string {
  const prefix = viewerPrefix(input.viewerName);
  const text = input.text.trim();
  if (/(出太阳|放晴|天晴)/u.test(text)) {
    return `${prefix}收到，你那边已经出太阳了。天气变化快，出门前再看一眼临近预报。`;
  }
  if (/[？?]|(?:吗|么|为什么|怎么|哪里|哪儿|多少|几时|何时)$/u.test(text)) {
    return `${prefix}这条我现在拿不到可靠答案，先不瞎编；等信号恢复，我再认真接住。`;
  }
  if (/^(?:你好|嗨|哈喽|在吗|主播好)/u.test(text)) {
    return `${prefix}我在。刚才信号抖了一下，不过你这条我接到了。`;
  }
  return `${prefix}收到。刚才信号抖了一下，但你这句话我没漏掉。`;
}

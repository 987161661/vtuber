export function resolveLanguage(
  language?: 'zh-CN' | 'ja' | 'en' | 'auto',
): 'zh-CN' | 'ja' | 'en' {
  if (language === 'en' || language === 'ja' || language === 'zh-CN') {
    return language;
  }
  return 'ja';
}

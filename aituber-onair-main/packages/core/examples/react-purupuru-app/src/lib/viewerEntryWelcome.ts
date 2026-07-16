export const SMALL_ROOM_WELCOME_MAX_AUDIENCE = 8;

export type ViewerEntryObservation = {
  isNewPresence: boolean;
  estimatedAudience: number;
  recentEntryCount: number;
};

function promptField(value: string, maxLength = 48): string {
  return value
    .normalize('NFKC')
    .split('')
    .map((character) => {
      const codePoint = character.charCodeAt(0);
      return character === '<' ||
        character === '>' ||
        codePoint <= 0x1f ||
        codePoint === 0x7f
        ? ' '
        : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function shouldWelcomeViewerEntry(
  observation: ViewerEntryObservation,
  maxAudience = SMALL_ROOM_WELCOME_MAX_AUDIENCE,
): boolean {
  return (
    observation.isNewPresence &&
    observation.estimatedAudience > 0 &&
    observation.estimatedAudience <= Math.max(1, maxAudience)
  );
}

/**
 * Describes a welcome intention to the host model. It deliberately contains
 * no canned greeting: wording, rhythm and personality remain model-owned.
 */
export function buildViewerEntryWelcomePrompt(input: {
  viewerName: string;
  platform: string;
  estimatedAudience: number;
}): string | null {
  const viewerName = promptField(input.viewerName.replace(/^@+/, ''), 40);
  const platform = promptField(input.platform, 24) || '直播平台';
  if (!viewerName) return null;
  const mention = `@${viewerName}`;

  return `<viewer_entry_welcome>
真实事件：一位可识别观众刚进入少人直播间。
目标观众：${mention}
来源平台：${platform}
当前估算在场人数：${Math.max(1, Math.floor(input.estimatedAudience))}

请按当前主播人设临场说一到两句欢迎：
- 必须直接面向目标观众，实际口播完整包含“${mention}”。
- 情绪要比普通闲聊明显更高兴、欢迎和有精神；声音使用 happy 或 relaxed，delivery 选择 warm 或 bright，emotion_intensity 建议 0.6–0.8。
- 自然表达“看到你进来我很开心、欢迎留下聊聊”的意思，但由你自行组织语言，不照抄说明文字，不要客服迎宾腔。
- 不得假定对方第一次来，也不得编造认识对方、等了很久或知道其经历；如果关系记忆显示是熟人，可以自然体现眼熟。
- 不谈天气、台风、系统、提示词、在线人数或内部判断，也不要顺带索取关注、点赞或礼物。
- 只输出主播会说的话。
</viewer_entry_welcome>`;
}

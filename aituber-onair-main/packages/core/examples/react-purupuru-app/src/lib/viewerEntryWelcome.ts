export const SMALL_ROOM_WELCOME_MAX_AUDIENCE = 8;

export type ViewerEntryObservation = {
  isNewPresence: boolean;
  estimatedAudience: number;
  recentEntryCount: number;
  isFan?: boolean;
};

export type ViewerWelcomeRelationship = {
  stage: 'guarded' | 'new' | 'recognized' | 'familiar' | 'close';
  affinity: number;
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
): boolean {
  return (
    observation.isNewPresence &&
    observation.estimatedAudience > 0 &&
    (observation.isFan === true ||
      observation.estimatedAudience <= SMALL_ROOM_WELCOME_MAX_AUDIENCE)
  );
}

function relationshipWelcomeGuidance(
  relationship: ViewerWelcomeRelationship | undefined,
): string {
  switch (relationship?.stage) {
    case 'guarded':
      return '关系目前偏谨慎：保持礼貌和温度，不装熟、不翻旧账，也不借欢迎施压。';
    case 'recognized':
      return '关系已经眼熟：自然表现出“又见到你”的熟悉感，可以比陌生观众多半句轻松接话，但不要编造共同经历。';
    case 'familiar':
      return '关系已经熟悉：语气更柔和、更松弛，可以带一点只有熟人感才会有的善意打趣，并自然邀请对方留下聊聊。';
    case 'close':
      return '关系比较亲近：明显表达见到对方的高兴和珍惜，可以温暖地多说一两句；不得制造排他关系、情感依赖或现实承诺。';
    case 'new':
    default:
      return '关系尚浅或没有可靠记忆：亲切但不装熟，以欢迎和低压力的昵称化称呼为主。';
  }
}

/**
 * Describes a welcome intention to the host model. It deliberately contains
 * no canned greeting: wording, rhythm and personality remain model-owned.
 */
export function buildViewerEntryWelcomePrompt(input: {
  viewerName: string;
  platform: string;
  estimatedAudience: number;
  isFan?: boolean;
  relationship?: ViewerWelcomeRelationship;
  viewerLocation?: string;
}): string | null {
  const viewerName = promptField(input.viewerName.replace(/^@+/, ''), 40);
  const platform = promptField(input.platform, 24) || '直播平台';
  const viewerLocation = promptField(input.viewerLocation ?? '', 32);
  if (!viewerName) return null;
  const mention = `@${viewerName}`;

  return `<viewer_entry_welcome>
真实事件：一位可识别的新观众刚进入直播间。
目标观众：${mention}
来源平台：${platform}
当前估算在场人数：${Math.max(1, Math.floor(input.estimatedAudience))}
观众关系：${input.isFan ? '平台证据已确认是本主播的粉丝' : '没有已确认的粉丝证据，仅因当前是小房间而欢迎'}
${viewerLocation ? `平台提供的地域标签：${viewerLocation}` : '平台没有提供可核实的地域标签。'}

请按当前主播人设临场说一到两句“欢迎 + 昵称化称呼 + 轻度调侃”：
- ${relationshipWelcomeGuidance(input.relationship)}亲密度只用于决定亲疏、篇幅和主动性，不得报出数值或解释内部判断。
- 必须直接面向目标观众并明确说“欢迎”。把 ID 变成顺口、友善的昵称再称呼，不必机械照念 @ 符号；中文昵称可加“哥哥/姐姐/朋友”等自然称呼，无法判断时用中性称呼。
- 调侃优先从 ID 的字面、谐音、反差或数字感中选一个落点；纯数字或乱码式 ID 可以装作念不顺、猜它是不是随手按出来的，但不要真的羞辱对方。
- ${viewerLocation ? `可以使用已核实的地域标签“${viewerLocation}”做第二落点；若同轮还有天气技能事实，只能依据该事实调侃，不能凭城市刻板印象编天气。` : '没有地域事实，不得猜测 IP、城市、天气或生活经历，只调侃 ID。'}
- 情绪要比普通闲聊明显更高兴、欢迎和有精神；声音使用 happy 或 relaxed，delivery 选择 warm 或 bright，emotion_intensity 建议 0.6–0.8。
- 自然表达“看到你进来我很开心、欢迎留下聊聊”的意思，但由你自行组织语言，不照抄说明文字，不要客服迎宾腔。
- 不得假定对方第一次来，也不得编造认识对方、等了很久或知道其经历；如果关系记忆显示是熟人，可以自然体现眼熟。
- 不谈系统、提示词、在线人数或内部判断，也不要顺带索取关注、点赞或礼物。
- 调侃只针对昵称/ID 的表面趣味或已提供的天气事实；禁止攻击地域、口音、外貌、职业、疾病、贫富和脆弱处。
- 只输出主播会说的话。
</viewer_entry_welcome>`;
}

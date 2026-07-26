export type IdleWeatherContentKind = 'weather-joke' | 'weather-fact';

export interface IdleWeatherContent {
  id: string;
  kind: IdleWeatherContentKind;
  text: string;
}

export interface IdleBroadcastRotationState {
  version: 1;
  cursor: number;
  usedWeatherIds: string[];
}

interface IdleBroadcastStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
}

const STORAGE_PREFIX = 'aituber-idle-broadcast-rotation:';
const WEATHER_SLOT_CYCLE: readonly (IdleWeatherContentKind | 'general')[] = [
  'weather-joke',
  'weather-fact',
  'weather-joke',
  'weather-fact',
  'weather-joke',
  'weather-fact',
  'weather-joke',
  'weather-fact',
  'general',
  'general',
];

const WEATHER_JOKES: readonly string[] = [
  '云为什么总在天上加班？因为它一落地，就会被叫作雾。',
  '天气预报最怕哪种观众？只看窗外一眼，就要求它为整座城市负责的观众。',
  '冷空气很讲礼貌，每次来之前都先让气温打个招呼：我先降了。',
  '雷为什么说话总像在生气？因为它从来没有室内音量。',
  '风最大的爱好是什么？翻别人的伞，还假装只是路过。',
  '积雨云去健身房练什么？练习把一肚子水举到高空。',
  '太阳今天没迟到，只是云替它按了静音。',
  '雾和云有什么职场区别？一个在高空办公，一个被调到地面驻场。',
  '雨滴为什么不坐电梯？因为它们习惯一步到地。',
  '气压低的时候，连空气都像在说：今天不想卷了。',
  '台风为什么总有名字？因为光叫“大风”不方便写值班记录。',
  '彩虹为什么从不加班？条件一消失，它立刻下班。',
  '雪花开会为什么很安静？因为每一片都觉得自己结构独特。',
  '湿度百分之百是什么体验？空气离拧出水只差一个动作。',
  '阵雨最擅长什么？把“马上就停”说得很有悬念。',
  '风向标为什么没主见？因为它的工作就是随风转。',
  '冰雹为什么不适合送快递？包裹和它通常只能完整一个。',
  '天气雷达最像哪种同事？平时不抢话，一开口就是一整片回波。',
  '露珠为什么起得早？因为太阳一上班，它就准备下班。',
  '高温最会做什么数学题？把体感温度不断往上加。',
  '寒潮进门为什么不用钥匙？门缝已经替它办好通行证。',
  '云层为什么喜欢叠被子？叠厚一点，阳光就透不过来了。',
  '天气预报里的“局地”住在哪里？住在每个没带伞的人头顶。',
  '闪电为什么拍照不用补光？因为它本人就是一次性闪光灯。',
  '风和树吵架谁先动手？通常是树先摇头，风却说不是它。',
  '雨伞为什么不爱大风天？因为每次见面都可能被迫换个方向生活。',
  '霜为什么只在清晨签名？太阳出来后，它的墨水就化了。',
  '副热带高压为什么坐得稳？因为它最擅长把热场子牢牢控住。',
  '天气模型为什么不买彩票？它知道概率，却不负责保证结果。',
  '雷雨天的云为什么脸色深？因为水汽和情绪都积得太多了。',
  '等压线为什么总爱抱团？因为离得越近，风就越有紧迫感。',
  '气象站为什么不怕沉默？温度、湿度和气压一直在替它发言。',
  '冷锋为什么走路带风？因为它后面的冷空气总在催它赶路。',
  '暖湿气流为什么爱聊天？因为一抬升，话题就容易凝结成云。',
  '天气预警为什么喜欢用颜色？因为只写“注意”很难让风险排队。',
  '云底为什么有时很平？水汽到了同一高度，集体决定开始凝结。',
  '海风为什么白天来上班？陆地升温快，给它腾出了气压差岗位。',
  '回南天为什么地板先知道？暖湿空气一来，冷表面立刻露馅。',
  '空气质量和天气是什么关系？有时风负责清场，有时静稳负责留人。',
  '降温为什么总说“断崖式”？因为“慢慢冷”听起来不够有坡度。',
];

const WEATHER_FACTS: readonly string[] = [
  '天气冷知识：雾其实就是贴近地面的云，主要区别在于它是否接触地面。',
  '天气冷知识：相对湿度百分之百不一定正在下雨，只表示空气接近水汽饱和。',
  '天气冷知识：闪电会把周围空气瞬间加热，空气急剧膨胀后形成我们听到的雷声。',
  '天气冷知识：先看到闪电、后听到雷，是因为光传播得远比声音快。',
  '天气冷知识：同样的气温下，湿度越高，汗液越难蒸发，人体往往觉得更闷热。',
  '天气冷知识：风寒效应不会让物体低于实际气温，但会让人体散热更快。',
  '天气冷知识：彩虹通常出现在背对太阳的方向，因为阳光要在水滴中折射和反射。',
  '天气冷知识：雪花常见六角结构，源头是水分子结冰时形成的六方晶格。',
  '天气冷知识：积雨云可以向上发展十几公里，是雷暴、短时强降水和冰雹的重要载体。',
  '天气冷知识：气压随海拔升高而降低，因为头顶空气柱的重量变小了。',
  '天气冷知识：露水通常不是从天上落下来的，而是近地面水汽在冷表面凝结形成的。',
  '天气冷知识：霜是水汽直接凝华成冰晶，并不需要先变成液态水。',
  '天气冷知识：冰雹在强对流云中被上升气流反复托举，冻结层数会逐渐增加。',
  '天气冷知识：台风眼里可能相对平静，但眼墙附近通常集中了最强风雨。',
  '天气冷知识：台风在北半球通常逆时针旋转，和地球自转产生的科里奥利力有关。',
  '天气冷知识：天气雷达主要接收降水粒子散射回来的电磁波，不是直接拍摄云朵。',
  '天气冷知识：雷达回波很强不一定全是暴雨，冰雹等较大粒子也能产生强回波。',
  '天气冷知识：降水概率描述特定地点和时段出现可测降水的可能性，不表示会下满对应比例的时间。',
  '天气冷知识：城市夜间常比郊外更暖，这种现象被称为城市热岛效应。',
  '天气冷知识：沙漠昼夜温差大，和空气干燥、云量少以及地表储热能力有限有关。',
  '天气冷知识：云看起来很轻，但一朵普通积云所含的小水滴总质量可能达到数百吨。',
  '天气冷知识：空气并非完全透明，天空呈蓝色主要与短波长蓝光更易被大气散射有关。',
  '天气冷知识：日落时太阳偏红，是因为阳光穿过更长的大气路径，蓝光被散射得更多。',
  '天气冷知识：冷锋经过时常伴随气温下降和风向变化，降水则取决于水汽与抬升条件。',
  '天气冷知识：暖锋的云和降水往往铺展得更广，因为暖空气沿冷空气缓慢爬升。',
  '天气冷知识：海风常在白天吹向陆地，因为陆地升温比海洋快，近地面气压差随之形成。',
  '天气冷知识：山谷风会随昼夜转换，白天地面受热常吹谷风，夜间冷却常吹山风。',
  '天气冷知识：飞机留下的凝结尾迹，是发动机排气中的水汽在低温高空凝结冻结形成的。',
  '天气冷知识：龙卷风尺度通常远小于台风，但局地瞬时风力可能极强。',
  '天气冷知识：天气和气候不是一回事，天气描述短期状态，气候关注较长时期的统计特征。',
  '天气冷知识：等压线越密集，通常意味着水平气压梯度越大，近地面风也更容易增强。',
  '天气冷知识：云底常显得平整，是因为上升空气往往在相近高度达到饱和并开始凝结。',
  '天气冷知识：逆温层会抑制空气向上交换，有时会让近地面污染物更难扩散。',
  '天气冷知识：回南天常发生在冷表面遇到暖湿空气时，水汽会在墙面和地板上凝结。',
  '天气冷知识：冻雨落地前是液态过冷水滴，碰到低于冰点的物体后会迅速冻结。',
  '天气冷知识：雨雪分界不只由地面温度决定，还取决于整层大气的温度结构。',
  '天气冷知识：强对流天气往往需要水汽、不稳定能量和抬升条件共同配合。',
  '天气冷知识：大气中的水汽大多集中在对流层，许多日常天气现象也发生在这一层。',
  '天气冷知识：静止锋附近冷暖空气势力相当，阴雨天气因此可能持续较久。',
  '天气冷知识：能见度会受雾、降水、沙尘和污染物影响，不能只根据有没有下雨判断。',
];

const WEATHER_CONTENT: readonly IdleWeatherContent[] = [
  ...WEATHER_JOKES.map((text, index) => ({
    id: `weather-joke-${index + 1}`,
    kind: 'weather-joke' as const,
    text,
  })),
  ...WEATHER_FACTS.map((text, index) => ({
    id: `weather-fact-${index + 1}`,
    kind: 'weather-fact' as const,
    text,
  })),
];

function storageKey(personaId: string) {
  return `${STORAGE_PREFIX}${personaId}`;
}

export function createIdleBroadcastRotationState(): IdleBroadcastRotationState {
  return { version: 1, cursor: 0, usedWeatherIds: [] };
}

export function loadIdleBroadcastRotation(
  storage: IdleBroadcastStorage,
  personaId: string,
): IdleBroadcastRotationState {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(personaId)) || '{}') as
      | Partial<IdleBroadcastRotationState>
      | undefined;
    const knownIds = new Set(WEATHER_CONTENT.map((item) => item.id));
    return {
      version: 1,
      cursor:
        typeof parsed?.cursor === 'number' &&
        Number.isSafeInteger(parsed.cursor) &&
        parsed.cursor >= 0
          ? parsed.cursor
          : 0,
      usedWeatherIds: Array.isArray(parsed?.usedWeatherIds)
        ? [...new Set(parsed.usedWeatherIds)]
            .filter(
              (id): id is string =>
                typeof id === 'string' && knownIds.has(id),
            )
            .slice(-WEATHER_CONTENT.length)
        : [],
    };
  } catch {
    return createIdleBroadcastRotationState();
  }
}

export function saveIdleBroadcastRotation(
  storage: IdleBroadcastStorage,
  personaId: string,
  state: IdleBroadcastRotationState,
) {
  try {
    storage.setItem(storageKey(personaId), JSON.stringify(state));
  } catch {
    // Storage failures must not stop live playback.
  }
}

export function selectIdleBroadcastContent(
  state: IdleBroadcastRotationState,
): {
  content: IdleWeatherContent | null;
  state: IdleBroadcastRotationState;
} {
  const requestedKind =
    WEATHER_SLOT_CYCLE[state.cursor % WEATHER_SLOT_CYCLE.length];
  const nextState: IdleBroadcastRotationState = {
    version: 1,
    cursor: state.cursor + 1,
    usedWeatherIds: [...state.usedWeatherIds],
  };
  if (requestedKind === 'general') {
    return { content: null, state: nextState };
  }

  const used = new Set(state.usedWeatherIds);
  const content =
    WEATHER_CONTENT.find(
      (item) => item.kind === requestedKind && !used.has(item.id),
    ) ??
    WEATHER_CONTENT.find(
      (item) => item.kind !== requestedKind && !used.has(item.id),
    ) ??
    null;
  if (content) nextState.usedWeatherIds.push(content.id);
  return { content, state: nextState };
}

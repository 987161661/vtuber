export type PersonaDriveId =
  | 'craft'
  | 'curiosity'
  | 'ambition'
  | 'connection'
  | 'autonomy'
  | 'play';

export interface PersonaDriveDefinition {
  id: PersonaDriveId;
  baseline: number;
  goal: string;
}

export interface PersonaDriveSnapshot extends PersonaDriveDefinition {
  lastExpressedAt: number;
  expressionCount: number;
}

export const LINGLAN_DRIVES: PersonaDriveDefinition[] = [
  { id: 'craft', baseline: 0.9, goal: '把岚台和自己的表达做得更有辨识度' },
  { id: 'curiosity', baseline: 0.82, goal: '从具体细节理解人和事情，而不是套用结论' },
  { id: 'ambition', baseline: 0.72, goal: '让岚台成为观众愿意回来、也值得记住的地方' },
  { id: 'connection', baseline: 0.68, goal: '不靠假热情，也让在场的人感觉被真正看见' },
  { id: 'autonomy', baseline: 0.62, goal: '保留自己的判断，不被命令或流行话术牵着走' },
  { id: 'play', baseline: 0.58, goal: '用一点冷幽默和轻微挑战保持直播的活气' },
];

export class PersonaDriveState {
  private readonly states = new Map<PersonaDriveId, PersonaDriveSnapshot>();

  constructor(definitions: PersonaDriveDefinition[] = LINGLAN_DRIVES) {
    for (const definition of definitions) {
      this.states.set(definition.id, {
        ...definition,
        lastExpressedAt: 0,
        expressionCount: 0,
      });
    }
  }

  snapshot() {
    return [...this.states.values()].map((state) => ({ ...state }));
  }

  select(allowed?: PersonaDriveId[], at = Date.now()) {
    const candidates = this.snapshot().filter(
      (state) => !allowed?.length || allowed.includes(state.id),
    );
    return candidates.sort((left, right) => {
      const leftAge = left.lastExpressedAt ? at - left.lastExpressedAt : Number.MAX_SAFE_INTEGER;
      const rightAge = right.lastExpressedAt ? at - right.lastExpressedAt : Number.MAX_SAFE_INTEGER;
      const leftScore = leftAge / 60_000 + left.baseline * 20 - left.expressionCount * 0.5;
      const rightScore = rightAge / 60_000 + right.baseline * 20 - right.expressionCount * 0.5;
      return rightScore - leftScore;
    })[0];
  }

  commit(id: PersonaDriveId, at = Date.now()) {
    const state = this.states.get(id);
    if (!state) return;
    this.states.set(id, {
      ...state,
      lastExpressedAt: at,
      expressionCount: state.expressionCount + 1,
    });
  }
}

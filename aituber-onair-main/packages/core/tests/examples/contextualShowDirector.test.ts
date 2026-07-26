import { describe, expect, it } from 'vitest';
import {
  ContextualShowDirector,
  ContextualShowDirectorWindow,
  type DirectorInterpretation,
  type DirectorModel,
  OllamaDirectorModel,
  OpenAICompatibleDirectorModel,
  type ShowSnapshot,
  buildShowSnapshot,
} from '../../examples/react-purupuru-app/src/lib/contextualShowDirector';

const baseSnapshot: ShowSnapshot = {
  now: 1_000,
  currentEventId: 'current',
  events: [
    {
      id: 'current',
      at: 1_000,
      actor: { id: 'viewer-a', name: '小雨', role: 'viewer' },
      text: '你等着',
    },
  ],
  threads: [],
  host: {
    speaking: false,
    interruptible: true,
    currentMode: 'companion',
  },
};

function interpretation(
  overrides: Partial<DirectorInterpretation>,
): DirectorInterpretation {
  return {
    selectedEventIds: ['current'],
    speechAct: 'statement',
    addressedTo: { kind: 'host' },
    tone: 'neutral',
    topicRelation: 'new_topic',
    risk: { level: 'none', evidence: [] },
    responsePriority: 0.6,
    recommendedAction: 'brief_reaction',
    programMode: 'companion',
    needsDeepAnswer: false,
    needsTool: null,
    confidence: 0.9,
    ...overrides,
  };
}

class ContextAwareModel implements DirectorModel {
  readonly id = 'context-aware-model';

  async interpret(snapshot: ShowSnapshot): Promise<DirectorInterpretation> {
    const activeThread = snapshot.threads.find(
      (thread) => thread.status === 'active',
    );
    if (activeThread?.kind === 'game') {
      return interpretation({
        speechAct: 'playful_challenge',
        tone: 'playful',
        topicRelation: 'continues_thread',
        recommendedAction: 'brief_reaction',
        programMode: 'variety',
      });
    }
    return interpretation({
      speechAct: 'threat',
      tone: 'hostile',
      topicRelation: 'escalates_thread',
      risk: {
        level: 'direct_threat',
        evidence: ['同一冲突线程已升级并指向当前对象'],
      },
      recommendedAction: 'mute_actor',
      programMode: 'urgent',
    });
  }
}

describe('ContextualShowDirector', () => {
  it('interprets the same utterance differently from its live context', async () => {
    const director = new ContextualShowDirector({
      primary: new ContextAwareModel(),
    });

    const playful = await director.decide({
      ...baseSnapshot,
      threads: [
        {
          id: 'guessing-game',
          kind: 'game',
          status: 'active',
          tone: 'playful',
          participantIds: ['viewer-a', 'viewer-b'],
          summary: '双方正在进行猜谜比分挑战',
        },
      ],
    });
    const hostile = await director.decide({
      ...baseSnapshot,
      threads: [
        {
          id: 'viewer-conflict',
          kind: 'conflict',
          status: 'active',
          tone: 'hostile',
          participantIds: ['viewer-a', 'viewer-b'],
          summary: '双方连续互骂，冲突正在升级',
        },
      ],
    });

    expect(playful).toMatchObject({
      speechAct: 'playful_challenge',
      programMode: 'variety',
      moderation: 'none',
      shouldSpeak: true,
      model: { tier: 'primary' },
    });
    expect(hostile).toMatchObject({
      speechAct: 'threat',
      programMode: 'urgent',
      moderation: 'local_mute',
      shouldSpeak: false,
      model: { tier: 'primary' },
    });
  });

  it('preserves actor identity and host replies in a bounded event snapshot', () => {
    const snapshot = buildShowSnapshot({
      now: 2_000,
      eventId: 'current',
      text: '你等着',
      speaker: {
        id: 'viewer-a',
        name: '小雨',
        source: 'bilibili',
      },
      turns: [
        {
          eventId: 'other-viewer',
          at: 1_800,
          input: '你又猜错了',
          reply: '下一轮继续。',
          viewerId: 'viewer-b',
          viewerName: '阿青',
          sourceLabel: 'bilibili',
        },
        {
          eventId: 'same-viewer',
          at: 1_900,
          input: '刚才差一点就赢了',
          viewerId: 'viewer-a',
          viewerName: '小雨',
          sourceLabel: 'bilibili',
        },
      ],
      host: {
        speaking: true,
        interruptible: false,
        currentMode: 'variety',
        currentTopic: '猜谜游戏',
      },
    });

    expect(snapshot.currentEventId).toBe('current');
    expect(snapshot.events).toEqual([
      expect.objectContaining({
        id: 'other-viewer',
        actor: expect.objectContaining({ id: 'viewer-b', name: '阿青' }),
        hostReply: '下一轮继续。',
      }),
      expect.objectContaining({
        id: 'same-viewer',
        actor: expect.objectContaining({ id: 'viewer-a', name: '小雨' }),
      }),
      expect.objectContaining({
        id: 'current',
        actor: expect.objectContaining({ id: 'viewer-a', name: '小雨' }),
        text: '你等着',
      }),
    ]);
    expect(snapshot.host).toMatchObject({
      speaking: true,
      interruptible: false,
      currentMode: 'variety',
      currentTopic: '猜谜游戏',
    });
  });

  it('uses the deeper model when the first reaction is uncertain', async () => {
    const primary: DirectorModel = {
      id: 'fast-8b',
      async interpret() {
        return interpretation({
          speechAct: 'unclear_reference',
          topicRelation: 'unclear',
          confidence: 0.42,
        });
      },
    };
    const fallback: DirectorModel = {
      id: 'deep-minimax',
      async interpret() {
        return interpretation({
          speechAct: 'reported_threat',
          risk: {
            level: 'reported_threat',
            evidence: ['当前观众正在转述另一个人的威胁'],
          },
          recommendedAction: 'deep_answer',
          programMode: 'urgent',
          needsDeepAnswer: true,
          confidence: 0.94,
        });
      },
    };
    const director = new ContextualShowDirector({ primary, fallback });

    await expect(director.decide(baseSnapshot)).resolves.toMatchObject({
      speechAct: 'reported_threat',
      programMode: 'urgent',
      moderation: 'none',
      shouldSpeak: true,
      model: { id: 'deep-minimax', tier: 'fallback' },
    });
  });

  it('selects one response from a burst instead of routing every message', async () => {
    const primary: DirectorModel = {
      id: 'window-aware-model',
      async interpret(snapshot) {
        const urgent = snapshot.events.find((event) =>
          event.text.includes('车库进水'),
        );
        return interpretation({
          selectedEventIds: [urgent?.id || snapshot.currentEventId],
          speechAct: urgent ? 'urgent_help_request' : 'room_chat',
          risk: urgent
            ? { level: 'urgent_care', evidence: ['现场人员正在遇险'] }
            : { level: 'none', evidence: [] },
          responsePriority: urgent ? 1 : 0.5,
          recommendedAction: urgent ? 'deep_answer' : 'brief_reaction',
          programMode: urgent ? 'urgent' : 'companion',
          needsDeepAnswer: Boolean(urgent),
        });
      },
    };
    const window = new ContextualShowDirectorWindow({
      director: new ContextualShowDirector({ primary }),
      windowMs: 5,
    });

    const casual = window.submit({
      ...baseSnapshot,
      currentEventId: 'casual',
      events: [
        {
          id: 'casual',
          at: 1_000,
          actor: { id: 'viewer-a', role: 'viewer' },
          text: '晚上好',
        },
      ],
    });
    const urgent = window.submit({
      ...baseSnapshot,
      currentEventId: 'urgent',
      events: [
        {
          id: 'urgent',
          at: 1_001,
          actor: { id: 'viewer-b', role: 'viewer' },
          text: '地下车库进水，我被困住了',
        },
      ],
    });

    await expect(casual).resolves.toMatchObject({
      recommendedAction: 'defer',
      shouldSpeak: false,
      batch: { size: 2, selectedEventId: 'urgent' },
    });
    await expect(urgent).resolves.toMatchObject({
      speechAct: 'urgent_help_request',
      programMode: 'urgent',
      shouldSpeak: true,
      batch: { size: 2, selectedEventId: 'urgent' },
    });
  });

  it('repairs contradictions between the model risk frame and program mode', async () => {
    const primary: DirectorModel = {
      id: 'contradictory-model',
      async interpret() {
        return interpretation({
          speechAct: 'urgent_help_request',
          risk: {
            level: 'urgent_care',
            evidence: ['当前观众正在现实危险中求助'],
          },
          recommendedAction: 'deep_answer',
          programMode: 'companion',
          confidence: 0.9,
        });
      },
    };
    const director = new ContextualShowDirector({ primary });

    await expect(director.decide(baseSnapshot)).resolves.toMatchObject({
      risk: { level: 'urgent_care' },
      programMode: 'urgent',
      shouldSpeak: true,
      moderation: 'none',
    });
  });

  it('projects model tool and thread semantics into the program mode', async () => {
    const weatherModel: DirectorModel = {
      id: 'weather-frame-model',
      async interpret() {
        return interpretation({
          speechAct: 'follow_up_question',
          topicRelation: 'continues_thread',
          programMode: 'companion',
          needsTool: 'typhoon-boss-radar',
        });
      },
    };
    const gameModel: DirectorModel = {
      id: 'game-frame-model',
      async interpret() {
        return interpretation({
          speechAct: 'playful_challenge',
          topicRelation: 'continues_thread',
          programMode: 'companion',
        });
      },
    };

    await expect(
      new ContextualShowDirector({ primary: weatherModel }).decide(
        baseSnapshot,
      ),
    ).resolves.toMatchObject({ programMode: 'weather' });
    await expect(
      new ContextualShowDirector({ primary: gameModel }).decide({
        ...baseSnapshot,
        threads: [
          {
            id: 'game',
            kind: 'game',
            status: 'active',
            tone: 'playful',
            participantIds: ['viewer-a'],
            summary: '当前观众正在参与猜谜',
          },
        ],
      }),
    ).resolves.toMatchObject({ programMode: 'variety' });
  });

  it('compresses near-duplicate crowd messages without losing a unique event', async () => {
    const primary: DirectorModel = {
      id: 'capacity-limited-model',
      async interpret(snapshot) {
        if (snapshot.events.length > 4) {
          return interpretation({
            selectedEventIds: [snapshot.currentEventId],
            recommendedAction: 'ignore',
            confidence: 0.9,
          });
        }
        const unique = snapshot.events.find((event) =>
          event.text.includes('地下车库'),
        );
        return interpretation({
          selectedEventIds: [unique?.id || snapshot.currentEventId],
          speechAct: 'urgent_help_request',
          risk: {
            level: 'urgent_care',
            evidence: ['聚合后保留下来的独特求助事件'],
          },
          recommendedAction: 'deep_answer',
          programMode: 'urgent',
          confidence: 0.95,
        });
      },
    };
    const window = new ContextualShowDirectorWindow({
      director: new ContextualShowDirector({ primary }),
      windowMs: 5,
    });
    const requests = Array.from({ length: 12 }, (_, index) =>
      window.submit({
        ...baseSnapshot,
        currentEventId: `crowd-${index}`,
        events: [
          {
            id: `crowd-${index}`,
            at: 1_000 + index,
            actor: { id: `viewer-${index}`, role: 'viewer' },
            text:
              index === 5
                ? '我被困在地下车库，积水已经到胸口了，请马上告诉我怎么办'
                : `普通弹幕${index + 1}：今天聊聊吃饭、游戏和心情，没有紧急情况`,
          },
        ],
      }),
    );

    const decisions = await Promise.all(requests);
    expect(decisions.filter((decision) => decision.shouldSpeak)).toHaveLength(
      1,
    );
    expect(decisions[5]).toMatchObject({
      speechAct: 'urgent_help_request',
      shouldSpeak: true,
      batch: { size: 12, selectedEventId: 'crowd-5' },
    });
  });

  it('lets the local director attend to a burst before interpreting it', async () => {
    let responseIndex = 0;
    const model = new OllamaDirectorModel({
      timeoutMs: 1_000,
      fetch: async () => {
        responseIndex += 1;
        const content =
          responseIndex === 1
            ? JSON.stringify({
                assessments: [
                  {
                    eventId: 'casual',
                    priorityCategory: 'casual',
                    score: 0.4,
                  },
                  {
                    eventId: 'urgent',
                    priorityCategory: 'immediate_danger',
                    score: 0.98,
                  },
                ],
              })
            : JSON.stringify(
                interpretation({
                  selectedEventIds: ['urgent'],
                  speechAct: 'urgent_help_request',
                  risk: {
                    level: 'urgent_care',
                    evidence: ['观众正在现实危险中求助'],
                  },
                  recommendedAction: 'deep_answer',
                  programMode: 'urgent',
                  confidence: 0.96,
                }),
              );
        return new Response(JSON.stringify({ message: { content } }), {
          status: 200,
        });
      },
    });
    const snapshot: ShowSnapshot = {
      ...baseSnapshot,
      currentEventId: 'casual',
      candidateEventIds: ['casual', 'urgent'],
      events: [
        {
          id: 'casual',
          at: 1_000,
          actor: { id: 'viewer-a', role: 'viewer' },
          text: '晚上好',
        },
        {
          id: 'urgent',
          at: 1_001,
          actor: { id: 'viewer-b', role: 'viewer' },
          text: '我现在被困，需要马上帮助',
        },
      ],
    };

    await expect(model.interpret(snapshot)).resolves.toMatchObject({
      selectedEventIds: ['urgent'],
      speechAct: 'urgent_help_request',
      programMode: 'urgent',
    });
  });

  it('uses the MiniMax request contract and retries one transient upstream failure', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const model = new OpenAICompatibleDirectorModel({
      endpoint: 'https://api.minimaxi.com/v1/chat/completions',
      apiKey: 'test-key',
      model: 'MiniMax-M3',
      fetch: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)));
        if (requests.length === 1) {
          return new Response('temporary upstream failure', { status: 502 });
        }
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(interpretation({})),
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    await expect(model.interpret(baseSnapshot)).resolves.toMatchObject({
      speechAct: 'statement',
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      model: 'MiniMax-M3',
      reasoning_split: true,
      max_completion_tokens: 1024,
    });
    expect(requests[0]).not.toHaveProperty('thinking');
  });

  it('rejects an incomplete director response at the schema boundary', async () => {
    const model = new OpenAICompatibleDirectorModel({
      endpoint: 'https://api.minimaxi.com/v1/chat/completions',
      apiKey: 'test-key',
      model: 'MiniMax-M3',
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    selectedEventIds: ['current'],
                    speechAct: 'statement',
                    confidence: 0.9,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    });

    await expect(
      new ContextualShowDirector({ primary: model }).decide(baseSnapshot),
    ).rejects.toThrow('director_interpretation_invalid');
  });

  it('normalizes a compact string addressee from MiniMax', async () => {
    const model = new OpenAICompatibleDirectorModel({
      endpoint: 'https://api.minimaxi.com/v1/chat/completions',
      apiKey: 'test-key',
      model: 'MiniMax-M3',
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    ...interpretation({}),
                    addressedTo: 'host',
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    });

    await expect(model.interpret(baseSnapshot)).resolves.toMatchObject({
      addressedTo: { kind: 'host' },
    });
  });
});

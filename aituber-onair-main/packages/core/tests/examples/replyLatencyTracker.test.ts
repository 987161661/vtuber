import { describe, expect, it, vi } from 'vitest';
import { createReplyLatencyTracker } from '../../examples/react-purupuru-app/src/lib/replyLatencyTracker';

const models = {
  llm: { provider: 'minimax', model: 'm3' },
  tts: { engine: 'minimax', model: 'speech-2.6', speaker: 'linglan' },
  lipSync: {
    engine: 'flashhead',
    model: 'default',
    mode: 'streaming' as const,
  },
};

describe('reply latency tracker', () => {
  it('reports one correlated latency record through the lifecycle seam', () => {
    let now = 100;
    const report = vi.fn();
    const tracker = createReplyLatencyTracker({
      now: () => now,
      createId: () => 'request-1',
      report,
    });

    tracker.start({
      source: 'live',
      inputAt: 100,
      models,
      input: 'question',
      eventId: 'event-1',
    });
    expect(tracker.context()).toEqual({
      requestId: 'request-1',
      source: 'live',
    });
    tracker.record({ type: 'llm-completed', at: 160, reply: 'answer' });
    tracker.record({ type: 'tts-requested', at: 180 });
    tracker.record({ type: 'tts-first-byte', at: 230 });
    tracker.record({ type: 'flashhead-first-frame', at: 250 });
    tracker.record({ type: 'first-playback', at: 270 });
    tracker.record({ type: 'speech-end-signaled', at: 400 });
    now = 420;

    const record = tracker.finish();

    expect(record).toMatchObject({
      requestId: 'request-1',
      eventId: 'event-1',
      reply: 'answer',
      endedAt: 420,
      inputToLlmMs: 60,
      llmToTtsRequestMs: 20,
      ttsRequestToFirstByteMs: 50,
      firstByteToPlaybackMs: 40,
      inputToTtsFirstByteMs: 130,
      inputToFlashHeadFirstFrameMs: 150,
      inputToFirstPlaybackMs: 170,
      inputToEndMs: 320,
    });
    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(record);
    expect(tracker.context()).toBeNull();
    expect(tracker.finish()).toBeNull();
  });

  it('keeps the first observable milestone when callbacks repeat', () => {
    const report = vi.fn();
    const tracker = createReplyLatencyTracker({
      now: () => 500,
      createId: () => 'request-1',
      report,
    });
    tracker.start({ source: 'chat', inputAt: 100, models });

    tracker.record({ type: 'tts-requested', at: 150 });
    tracker.record({ type: 'tts-requested', at: 175 });
    tracker.record({ type: 'tts-first-byte', at: 200 });
    tracker.record({ type: 'tts-first-byte', at: 250 });
    tracker.record({ type: 'first-playback', at: 300 });
    tracker.record({ type: 'first-playback', at: 350 });

    expect(tracker.finish()).toMatchObject({
      ttsRequestedAt: 150,
      ttsFirstByteAt: 200,
      firstPlaybackAt: 300,
    });
  });

  it('rejects a late LLM callback from another event', () => {
    const tracker = createReplyLatencyTracker({
      now: () => 500,
      createId: () => 'request-1',
      report: vi.fn(),
    });
    tracker.start({
      source: 'live',
      inputAt: 100,
      models,
      eventId: 'current-event',
    });

    expect(
      tracker.record({
        type: 'llm-completed',
        at: 200,
        eventId: 'late-event',
        requireEventMatch: true,
        reply: 'stale',
      }),
    ).toBe(false);
    expect(tracker.finish()).not.toHaveProperty('reply');
  });

  it('can discard an abandoned trace without reporting it', () => {
    const report = vi.fn();
    const tracker = createReplyLatencyTracker({
      now: () => 500,
      createId: () => 'request-1',
      report,
    });
    tracker.start({ source: 'vision', inputAt: 100, models });

    tracker.reset();

    expect(tracker.context()).toBeNull();
    expect(tracker.finish()).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });
});

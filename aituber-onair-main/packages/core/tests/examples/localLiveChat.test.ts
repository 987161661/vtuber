import { describe, expect, it, vi } from 'vitest';
import {
  buildLocalLiveChatRequest,
  classifyLocalReplyContract,
  enforceLocalReplyContract,
  LOCAL_LIVE_CHAT_TIMEOUT_MS,
  parseLocalLiveChatResponse,
  requestLocalLiveChat,
} from '../../examples/react-purupuru-app/server/localLiveChat';

describe('local live chat', () => {
  it('allows the warmed local model enough time to produce a short reply', () => {
    expect(LOCAL_LIVE_CHAT_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
  });

  it('builds a bounded non-thinking conversational request', () => {
    const request = buildLocalLiveChatRequest({
      text: '你是机器人吗？',
      viewerName: '小雨',
      recentContext: '小雨：晚上好',
    });

    expect(request.model).toBe('qwen3:8b');
    expect(request.think).toBe(false);
    expect(request.stream).toBe(false);
    expect(request.messages.at(-1)?.content).toBe('小雨说：你是机器人吗?');
    expect(request.messages[1].content).toContain('算是，我是AI数字主播凌岚');
  });

  it('selects small operational truth contracts instead of broad canned Q&A', () => {
    expect(classifyLocalReplyContract('你是机器人吗？')).toBe('identity');
    expect(classifyLocalReplyContract('怎么还不说话')).toBe('latency');
    expect(classifyLocalReplyContract('今晚在干嘛')).toBe('general');
  });

  it('repairs only contract-breaking identity and latency replies', () => {
    expect(
      enforceLocalReplyContract({ text: '你是机器人吗？' }, '你那边能听见吗？'),
    ).toBe('算是，我是AI数字主播凌岚。');
    expect(
      enforceLocalReplyContract({ text: '你怎么不说话？' }, '我这边一切正常。'),
    ).toBe('刚才可能卡住了，现在能听见吗？');
    expect(
      enforceLocalReplyContract({ text: '在干嘛？' }, '在等你抛个好问题。'),
    ).toBe('在等你抛个好问题。');
  });

  it('rejects an empty input and strips hidden reasoning from output', () => {
    expect(() => buildLocalLiveChatRequest({ text: '   ' })).toThrow(
      'local_live_chat_text_required',
    );
    expect(
      parseLocalLiveChatResponse({
        message: { content: '<think>hidden</think>\n我是AI数字主播。' },
      }),
    ).toBe('我是AI数字主播。');
  });

  it('uses the local Ollama endpoint and returns the final reply', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: { content: '刚才可能卡住了，现在能听见吗？' },
          }),
          { status: 200 },
        ),
    );

    await expect(
      requestLocalLiveChat(
        { text: '你怎么不说话', viewerName: '小雨' },
        { fetchImpl },
      ),
    ).resolves.toBe('刚才可能卡住了，现在能听见吗？');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

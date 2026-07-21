import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MINIMAX_CHINA_API_URL,
  MINIMAX_GLOBAL_API_URL,
} from '../src/constants/voiceEngine';
import { MinimaxEngine, type MinimaxModel } from '../src/engines/MinimaxEngine';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MinimaxEngine', () => {
  describe('streaming chunking', () => {
    it('retries a transient gateway failure before yielding any audio', async () => {
      vi.useFakeTimers();
      const engine = new MinimaxEngine();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 502 }))
        .mockResolvedValueOnce(
          new Response(
            `data: ${JSON.stringify({ data: { audio: '0a0b', status: 2 } })}\n\n`,
            {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            },
          ),
        );
      vi.stubGlobal('fetch', fetchMock);

      const chunksPromise = (async () => {
        const chunks: Uint8Array[] = [];
        for await (const chunk of engine.fetchAudioStream(
          { style: 'talk', message: 'test' },
          'voice-id',
          'api-key',
        )) {
          chunks.push(new Uint8Array(chunk));
        }
        return chunks;
      })();
      const assertion = expect(chunksPromise).resolves.toEqual([
        new Uint8Array([10, 11]),
      ]);
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('splits oversized SSE audio payloads into bounded chunks', async () => {
      const engine = new MinimaxEngine();
      const audio = new Uint8Array(70_000);
      for (let index = 0; index < audio.length; index += 1) {
        audio[index] = index % 251;
      }
      const hex = Array.from(audio, (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('');
      const response = new Response(
        `data: ${JSON.stringify({ data: { audio: hex, status: 1 } })}\n\n`,
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

      const chunks: Uint8Array[] = [];
      for await (const chunk of engine.fetchAudioStream(
        { style: 'talk', message: 'test' },
        'voice-id',
        'api-key',
      )) {
        chunks.push(new Uint8Array(chunk));
      }

      expect(chunks.map((chunk) => chunk.byteLength)).toEqual([
        16_384, 32_768, 20_848,
      ]);
      expect(
        new Uint8Array(chunks.flatMap((chunk) => Array.from(chunk))),
      ).toEqual(audio);
    });

    it('does not append the terminal full-audio copy after incremental audio', async () => {
      const engine = new MinimaxEngine();
      const incrementalHex = '01020304';
      const terminalFullHex = '0102030401020304';
      const body =
        `data: ${JSON.stringify({ data: { audio: incrementalHex, status: 1 } })}\n\n` +
        `data: ${JSON.stringify({ data: { audio: terminalFullHex, status: 2 } })}\n\n`;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(body, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      );

      const chunks: Uint8Array[] = [];
      for await (const chunk of engine.fetchAudioStream(
        { style: 'talk', message: 'test' },
        'voice-id',
        'api-key',
      )) {
        chunks.push(new Uint8Array(chunk));
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('stops at terminal status even when the SSE transport stays open', async () => {
      const engine = new MinimaxEngine();
      const encoder = new TextEncoder();
      const cancelled = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ data: { audio: '01020304', status: 1 } })}\n\n` +
                `data: ${JSON.stringify({ data: { audio: '01020304', status: 2 } })}\n\n`,
            ),
          );
        },
        cancel: cancelled,
      });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(body, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      );

      const chunks: Uint8Array[] = [];
      for await (const chunk of engine.fetchAudioStream(
        { style: 'talk', message: 'test' },
        'voice-id',
        'api-key',
      )) {
        chunks.push(new Uint8Array(chunk));
      }

      expect(cancelled).toHaveBeenCalledOnce();
      expect(chunks).toEqual([new Uint8Array([1, 2, 3, 4])]);
    });

    it('aborts a status=1 stream that stops making audio progress', async () => {
      vi.useFakeTimers();
      const engine = new MinimaxEngine();
      const encoder = new TextEncoder();
      const cancelled = vi.fn();
      const audio = new Uint8Array(17_000).fill(7);
      const hex = Array.from(audio, (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('');
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ data: { audio: hex, status: 1 } })}\n\n`,
            ),
          );
        },
        cancel: cancelled,
      });
      let requestSignal: AbortSignal | null = null;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_input, init: RequestInit) => {
          requestSignal = init.signal as AbortSignal;
          return Promise.resolve(
            new Response(body, {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            }),
          );
        }),
      );

      const iterator = engine.fetchAudioStream(
        { style: 'talk', message: 'test' },
        'voice-id',
        'api-key',
      );
      const first = await iterator.next();
      expect(first.value?.byteLength).toBe(16_384);

      const tailPromise = iterator.next();
      await vi.advanceTimersByTimeAsync(8_001);
      const tail = await tailPromise;

      expect(tail.value?.byteLength).toBe(616);
      expect(requestSignal?.aborted).toBe(true);
      expect(cancelled).toHaveBeenCalledOnce();
      await expect(iterator.next()).resolves.toMatchObject({ done: true });
    });

    it('keeps status=2 audio when it is the only audio response', async () => {
      const engine = new MinimaxEngine();
      const body = `data: ${JSON.stringify({ data: { audio: '0a0b', status: 2 } })}\n\n`;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(body, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      );

      const chunks: Uint8Array[] = [];
      for await (const chunk of engine.fetchAudioStream(
        { style: 'talk', message: 'test' },
        'voice-id',
        'api-key',
      )) {
        chunks.push(new Uint8Array(chunk));
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(new Uint8Array([10, 11]));
    });
  });

  describe('Configuration Methods', () => {
    it('should set and use different models', () => {
      const engine = new MinimaxEngine();
      const models: MinimaxModel[] = [
        'speech-2.6-hd',
        'speech-2.6-turbo',
        'speech-2.5-hd-preview',
        'speech-2.5-turbo-preview',
        'speech-02-hd',
        'speech-02-turbo',
        'speech-01-hd',
        'speech-01-turbo',
      ];

      models.forEach((model) => {
        engine.setModel(model);
        // Since getModel is private, we'll test this through fetchAudio
        expect(() => engine.setModel(model)).not.toThrow();
      });
    });

    it('should set GroupId', () => {
      const engine = new MinimaxEngine();
      const groupId = 'test-group-id-123';

      expect(() => engine.setGroupId(groupId)).not.toThrow();
    });

    it('should set endpoint to global', () => {
      const engine = new MinimaxEngine();

      expect(() => engine.setEndpoint('global')).not.toThrow();
    });

    it('should set endpoint to china', () => {
      const engine = new MinimaxEngine();

      expect(() => engine.setEndpoint('china')).not.toThrow();
    });

    it('should set language', () => {
      const engine = new MinimaxEngine();

      expect(() => engine.setLanguage('English')).not.toThrow();
      expect(() => engine.setLanguage('Japanese')).not.toThrow();
    });
  });

  describe('Override Handling', () => {
    it('should apply voice and audio overrides in requests', async () => {
      const engine = new MinimaxEngine();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          base_resp: { status_code: 0 },
          data: { audio: '00' },
        }),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as any;

      try {
        engine.setVoiceSettings({ speed: 1.4, vol: 0.85, pitch: 2 });
        engine.setSpeed(1.5);
        engine.setVolume(0.9);
        engine.setAudioSettings({
          sampleRate: 44100,
          bitrate: 96000,
          format: 'wav',
          channel: 2,
        });
        engine.setAudioFormat('mp3');
        engine.setSampleRate(32000);
        engine.setBitrate(128000);
        engine.setAudioChannel(1);

        await engine.testVoice('hello world', 'test-speaker', 'api-key');

        expect(fetchMock).toHaveBeenCalled();
        const call = fetchMock.mock.calls[0];
        expect(call[0]).toBe(MINIMAX_CHINA_API_URL);
        const body = JSON.parse(call[1].body);
        expect(body.voice_setting.speed).toBe(1.5);
        expect(body.voice_setting.vol).toBe(0.9);
        expect(body.voice_setting.pitch).toBe(2);
        expect(body.audio_setting.sample_rate).toBe(32000);
        expect(body.audio_setting.bitrate).toBe(128000);
        expect(body.audio_setting.format).toBe('mp3');
        expect(body.audio_setting.channel).toBe(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should fall back to defaults after clearing overrides', async () => {
      const engine = new MinimaxEngine();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          base_resp: { status_code: 0 },
          data: { audio: '00' },
        }),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as any;

      try {
        engine.setSpeed(1.6);
        engine.setSpeed(undefined);
        engine.setSampleRate(44100);
        engine.setSampleRate(undefined);

        await engine.testVoice('hello world', 'test-speaker', 'api-key');

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.voice_setting.speed).toBe(1.0);
        expect(body.audio_setting.sample_rate).toBe(44100);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('getVoiceList', () => {
    it('should reject because MiniMax does not expose a confirmed voice list API', async () => {
      const engine = new MinimaxEngine();

      await expect(engine.getVoiceList()).rejects.toThrow(
        'MiniMax voice list API is not supported',
      );
    });
  });

  describe('testVoice', () => {
    it('should synthesize a test voice without requiring configured GroupId', async () => {
      const engine = new MinimaxEngine();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          base_resp: { status_code: 0 },
          data: { audio: '000102ff' },
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await engine.testVoice('hello', 'voice-id', 'api-key');

      expect(new Uint8Array(result)).toEqual(new Uint8Array([0, 1, 2, 255]));
      expect(fetchMock.mock.calls[0][0]).toBe(MINIMAX_CHINA_API_URL);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
        model: 'speech-2.8-turbo',
        text: 'hello',
        stream: false,
        voice_setting: {
          voice_id: 'voice-id',
          speed: 1,
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 44100,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
        language_boost: 'Chinese',
      });
    });

    it('should validate test voice inputs and invalid response structures', async () => {
      const engine = new MinimaxEngine();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            base_resp: { status_code: 0 },
            data: {},
          }),
        }),
      );

      await expect(engine.testVoice('hello', 'voice-id', '')).rejects.toThrow(
        'MiniMax API key is required',
      );
      await expect(engine.testVoice('hello', '', 'api-key')).rejects.toThrow(
        'Voice ID is required',
      );
      await expect(
        engine.testVoice('hello', 'voice-id', 'api-key'),
      ).rejects.toThrow('Audio data not found in MiniMax response');
    });

    it('should propagate test voice HTTP and base response errors', async () => {
      const engine = new MinimaxEngine();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 402,
          text: async () => 'quota exceeded',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            base_resp: {
              status_code: 2001,
              status_msg: 'bad voice',
            },
          }),
        });
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        engine.testVoice('hello', 'voice-id', 'api-key'),
      ).rejects.toThrow('Failed to test voice: 402 - quota exceeded');
      await expect(
        engine.testVoice('hello', 'voice-id', 'api-key'),
      ).rejects.toThrow('MiniMax API error: 2001 - bad voice');
    });

    it('should reject invalid hex audio data', async () => {
      const engine = new MinimaxEngine();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            base_resp: { status_code: 0 },
            data: { audio: 'xyz' },
          }),
        }),
      );

      await expect(
        engine.testVoice('hello', 'voice-id', 'api-key'),
      ).rejects.toThrow('Failed to process audio data');
    });
  });

  describe('fetchAudio', () => {
    it('should synthesize production audio with GroupId', async () => {
      const engine = new MinimaxEngine();
      engine.setGroupId('group-id');
      engine.setEndpoint('china');
      engine.setModel('speech-02-hd');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          base_resp: { status_code: 0 },
          data: { audio: '0a0b' },
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await engine.fetchAudio(
        {
          style: 'happy',
          message: '  hello  ',
        },
        'voice-id',
        'api-key',
      );

      expect(new Uint8Array(result)).toEqual(new Uint8Array([10, 11]));
      expect(fetchMock.mock.calls[0][0]).toBe(MINIMAX_CHINA_API_URL);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
        model: 'speech-02-hd',
        text: 'hello',
        voice_setting: {
          voice_id: 'voice-id',
          speed: 1,
          vol: 1,
          pitch: 0,
          emotion: 'happy',
        },
      });
    });

    it('should convert delivery and intensity into distinct MiniMax voice settings', async () => {
      const engine = new MinimaxEngine();
      engine.setGroupId('group-id');
      engine.setEndpoint('china');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          base_resp: { status_code: 0 },
          data: { audio: '0a0b' },
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await engine.fetchAudio(
        {
          style: 'relaxed',
          delivery: 'warm',
          emotionIntensity: 0.62,
          message: 'warm answer',
        },
        'voice-id',
        'api-key',
      );
      await engine.fetchAudio(
        {
          style: 'bored',
          delivery: 'serious',
          emotionIntensity: 0.7,
          message: 'serious answer',
        },
        'voice-id',
        'api-key',
      );

      const warm = JSON.parse(fetchMock.mock.calls[0][1].body).voice_setting;
      const serious = JSON.parse(fetchMock.mock.calls[1][1].body).voice_setting;
      expect(warm).toMatchObject({
        emotion: 'neutral',
        speed: 0.98,
        vol: 0.98,
        pitch: 0,
      });
      expect(serious).toMatchObject({ emotion: 'neutral', pitch: 0 });
      expect(serious.speed).toBe(0.94);
      expect(serious.vol).toBeCloseTo(0.9299, 5);
      expect(warm).not.toEqual(serious);
    });

    it('maps nuanced host emotions to MiniMax-supported emotion controls', async () => {
      const engine = new MinimaxEngine();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          base_resp: { status_code: 0 },
          data: { audio: '0a0b' },
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await engine.fetchAudio(
        {
          style: 'bored',
          delivery: 'calm',
          emotionIntensity: 0.42,
          message: '我听见了。',
        },
        'voice-id',
        'api-key',
      );
      await engine.fetchAudio(
        {
          style: 'impatient',
          delivery: 'serious',
          emotionIntensity: 0.55,
          message: '先别催。',
        },
        'voice-id',
        'api-key',
      );
      await engine.fetchAudio(
        {
          style: 'awkward',
          delivery: 'soft',
          emotionIntensity: 0.38,
          message: '你这么说，我有点不知道怎么接。',
        },
        'voice-id',
        'api-key',
      );

      const [bored, impatient, awkward] = fetchMock.mock.calls.map(
        (call) => JSON.parse(call[1].body).voice_setting,
      );
      expect(bored).toMatchObject({ emotion: 'neutral', pitch: 0 });
      expect(bored.speed).toBe(0.94);
      expect(impatient).toMatchObject({ emotion: 'angry', pitch: 0 });
      expect(impatient.speed).toBeCloseTo(1.007625, 5);
      expect(awkward).toMatchObject({ emotion: 'surprised', pitch: 0 });
      expect(awkward.speed).toBe(0.94);
      expect(bored).not.toEqual(impatient);
      expect(impatient).not.toEqual(awkward);
    });

    it('applies composable prosody controls without changing the selected voice', async () => {
      const engine = new MinimaxEngine();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          base_resp: { status_code: 0 },
          data: { audio: '0a0b' },
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await engine.fetchAudio(
        {
          style: 'embarrassed',
          delivery: 'soft',
          emotionIntensity: 0.4,
          prosody: {
            pace: -0.5,
            pitch: -0.3,
            volume: -0.4,
            warmth: 0.7,
            breathiness: 0.4,
          },
          message: '这个……先不说。',
        },
        'voice-id',
        'api-key',
      );

      const setting = JSON.parse(fetchMock.mock.calls[0][1].body).voice_setting;
      expect(setting.voice_id).toBe('voice-id');
      expect(setting.emotion).toBe('surprised');
      expect(setting.speed).toBe(0.94);
      expect(setting.vol).toBe(0.9);
      expect(setting.pitch).toBe(0);
    });

    it('should validate production synthesis inputs', async () => {
      const engine = new MinimaxEngine();

      await expect(
        engine.fetchAudio({ style: 'talk', message: 'hello' }, 'voice-id'),
      ).rejects.toThrow('MiniMax API key is required');
      await expect(
        engine.fetchAudio(
          { style: 'talk', message: 'x'.repeat(5001) },
          'voice-id',
          'api-key',
        ),
      ).rejects.toThrow('Text exceeds maximum length of 5000 characters');
    });
  });

  describe('getTestMessage', () => {
    it('should return default test message', () => {
      const engine = new MinimaxEngine();
      expect(engine.getTestMessage()).toBe('MiniMax Audioを使用します');
    });

    it('should return custom test message', () => {
      const engine = new MinimaxEngine();
      const customMessage = 'Custom test message';
      expect(engine.getTestMessage(customMessage)).toBe(customMessage);
    });
  });

  describe('endpoint helpers', () => {
    it('should expose current endpoint and infer endpoint from API URL', () => {
      const engine = new MinimaxEngine();

      expect(engine.hasGroupId()).toBe(false);
      expect(engine.getEndpoint()).toBe('china');
      engine.setGroupId('group-id');
      expect(engine.hasGroupId()).toBe(true);
      engine.setApiEndpoint('https://api.minimaxi.com/v1/t2a_v2');
      expect(engine.getEndpoint()).toBe('china');
      engine.setApiEndpoint('https://api.minimax.io/v1/t2a_v2');
      expect(engine.getEndpoint()).toBe('global');
    });
  });
});

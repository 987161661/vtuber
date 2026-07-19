export type ReplyLatencySource = 'chat' | 'live' | 'vision';

export type ReplyModelTrace = {
  llm: { provider: string; model: string };
  tts: { engine: string; model: string; speaker: string };
  lipSync: {
    engine: string;
    model: string;
    mode: 'streaming' | 'full-audio';
  };
};

export type ReplyLatencyStart = {
  requestId?: string;
  source: ReplyLatencySource;
  inputAt: number;
  models: ReplyModelTrace;
  input?: string;
  eventId?: string;
  attemptId?: string;
  origin?: {
    channel: string;
    requestId?: string;
    viewerId?: string;
    viewerName?: string;
    commentAt?: number;
    receivedAt?: number;
    sourcesSeen?: string[];
  };
};

type LlmCompletedEvent = {
  type: 'llm-completed';
  at?: number;
  input?: string;
  reply?: string;
  eventId?: string;
  attemptId?: string;
  requireEventMatch?: boolean;
};

export type ReplyLatencyEvent =
  | LlmCompletedEvent
  | {
      type:
        | 'tts-requested'
        | 'tts-first-byte'
        | 'flashhead-first-frame'
        | 'first-playback'
        | 'speech-end-signaled';
      at?: number;
    };

type ReplyLatencyTrace = ReplyLatencyStart & {
  requestId: string;
  llmCompletedAt?: number;
  ttsRequestedAt?: number;
  ttsFirstByteAt?: number;
  flashHeadFirstFrameAt?: number;
  firstPlaybackAt?: number;
  speechEndSignaledAt?: number;
  reply?: string;
};

export type ReplyLatencyRecord = ReplyLatencyTrace & {
  endedAt: number;
  inputToLlmMs: number | null;
  llmToTtsRequestMs: number | null;
  ttsRequestToFirstByteMs: number | null;
  firstByteToPlaybackMs: number | null;
  inputToTtsFirstByteMs: number | null;
  inputToFlashHeadFirstFrameMs: number | null;
  inputToFirstPlaybackMs: number | null;
  inputToEndMs: number;
};

type Reporter = (record: ReplyLatencyRecord) => void | Promise<void>;

export function createReplyLatencyTracker(options: {
  now: () => number;
  createId: () => string;
  report: Reporter;
}) {
  let trace: ReplyLatencyTrace | null = null;

  const recordFirst = (field: keyof ReplyLatencyTrace, at: number) => {
    if (trace && trace[field] === undefined) {
      Object.assign(trace, { [field]: at });
    }
  };

  return {
    start(start: ReplyLatencyStart): void {
      trace = {
        ...start,
        requestId: start.requestId ?? options.createId(),
      };
    },

    context(): Pick<ReplyLatencyTrace, 'requestId' | 'source'> | null {
      return trace
        ? { requestId: trace.requestId, source: trace.source }
        : null;
    },

    record(event: ReplyLatencyEvent): boolean {
      if (!trace) return false;
      const at = event.at ?? options.now();
      if (event.type === 'llm-completed') {
        if (
          event.requireEventMatch &&
          (!event.eventId || trace.eventId !== event.eventId)
        ) {
          return false;
        }
        trace.llmCompletedAt = at;
        if (event.input !== undefined) trace.input = event.input;
        if (event.reply !== undefined) trace.reply = event.reply;
        if (event.eventId !== undefined) trace.eventId = event.eventId;
        if (event.attemptId !== undefined) trace.attemptId = event.attemptId;
        return true;
      }
      const fields = {
        'tts-requested': 'ttsRequestedAt',
        'tts-first-byte': 'ttsFirstByteAt',
        'flashhead-first-frame': 'flashHeadFirstFrameAt',
        'first-playback': 'firstPlaybackAt',
        'speech-end-signaled': 'speechEndSignaledAt',
      } as const;
      recordFirst(fields[event.type], at);
      return true;
    },

    finish(): ReplyLatencyRecord | null {
      if (!trace) return null;
      const completed = trace;
      trace = null;
      const endedAt = options.now();
      const record: ReplyLatencyRecord = {
        ...completed,
        endedAt,
        inputToLlmMs: elapsed(completed.inputAt, completed.llmCompletedAt),
        llmToTtsRequestMs: elapsed(
          completed.llmCompletedAt,
          completed.ttsRequestedAt,
        ),
        ttsRequestToFirstByteMs: elapsed(
          completed.ttsRequestedAt,
          completed.ttsFirstByteAt,
        ),
        firstByteToPlaybackMs: elapsed(
          completed.ttsFirstByteAt,
          completed.firstPlaybackAt,
        ),
        inputToTtsFirstByteMs: elapsed(
          completed.inputAt,
          completed.ttsFirstByteAt,
        ),
        inputToFlashHeadFirstFrameMs: elapsed(
          completed.inputAt,
          completed.flashHeadFirstFrameAt,
        ),
        inputToFirstPlaybackMs: elapsed(
          completed.inputAt,
          completed.firstPlaybackAt,
        ),
        inputToEndMs: endedAt - completed.inputAt,
      };
      try {
        void Promise.resolve(options.report(record)).catch(() => undefined);
      } catch {
        // Telemetry must never break speech playback.
      }
      return record;
    },

    reset(): void {
      trace = null;
    },
  };
}

export function createReplyLatencyHttpReporter(
  request: typeof fetch,
): Reporter {
  return async (record) => {
    await request('/api/reply-latency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  };
}

function elapsed(start: number | undefined, end: number | undefined) {
  return start !== undefined && end !== undefined ? end - start : null;
}

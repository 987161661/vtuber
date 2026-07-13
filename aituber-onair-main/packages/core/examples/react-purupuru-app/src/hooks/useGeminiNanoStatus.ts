import { useCallback, useEffect, useRef, useState } from 'react';

export type GeminiNanoStatus =
  | 'checking'
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable'
  | 'error';

interface LanguageModelAPI {
  availability(options?: Record<string, unknown>): Promise<string>;
  create(options?: Record<string, unknown>): Promise<{ destroy(): void }>;
}

interface GeminiNanoState {
  status: GeminiNanoStatus;
  statusText: string;
  downloadProgress: number | null;
  isPreparing: boolean;
  prepareModel: () => void;
}

const MODEL_IO = {
  expectedInputs: [{ type: 'text', languages: ['ja'] }],
  expectedOutputs: [{ type: 'text', languages: ['ja'] }],
};

function getLanguageModel(): LanguageModelAPI | undefined {
  return (globalThis as Record<string, unknown>)
    .LanguageModel as LanguageModelAPI;
}

export function useGeminiNanoStatus(enabled: boolean): GeminiNanoState {
  const [status, setStatus] = useState<GeminiNanoStatus>('checking');
  const [statusText, setStatusText] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const preparingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      queueMicrotask(() => {
        setStatus('checking');
        setStatusText('');
        setDownloadProgress(null);
      });
      return;
    }

    let cancelled = false;

    async function check() {
      const lm = getLanguageModel();
      if (!lm) {
        if (!cancelled) {
          setStatus('unavailable');
          setStatusText(
            '请在 Chrome 138 或更高版本中启用内置 AI 标志。',
          );
        }
        return;
      }

      try {
        const result = await lm.availability(MODEL_IO);
        if (cancelled) {
          return;
        }

        if (result === 'available') {
          setStatus('available');
          setStatusText('Gemini Nano 已可用。');
        } else if (result === 'downloading') {
          setStatus('downloading');
          setStatusText('正在下载 Gemini Nano 模型。');
        } else if (result === 'downloadable') {
          setStatus('downloadable');
          setStatusText(
            '需要准备 Gemini Nano 模型，请点击“准备模型”。',
          );
        } else {
          setStatus('unavailable');
          setStatusText(
            '请在 Chrome 138 或更高版本中启用内置 AI 标志。',
          );
        }
      } catch {
        if (!cancelled) {
          setStatus('error');
          setStatusText('无法检查浏览器内置 AI 状态。');
        }
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const prepareModel = useCallback(() => {
    if (preparingRef.current) {
      return;
    }

    const lm = getLanguageModel();
    if (!lm) {
      return;
    }

    preparingRef.current = true;
    setIsPreparing(true);
    setStatus('downloading');
    setStatusText('正在下载 Gemini Nano 模型。');
    setDownloadProgress(0);

    lm.create({
      ...MODEL_IO,
      systemPrompt: 'You are a helpful assistant.',
      monitor: (monitor: {
        addEventListener(
          event: string,
          handler: (event: { loaded: number }) => void,
        ): void;
      }) => {
        monitor.addEventListener(
          'downloadprogress',
          (event: { loaded: number }) => {
            if (!mountedRef.current) {
              return;
            }
            const progress = Math.round((event.loaded || 0) * 100);
            setDownloadProgress(progress);
            setStatusText(
              `正在下载 Gemini Nano 模型：${progress}%`,
            );
          },
        );
      },
    })
      .then((session) => {
        try {
          session.destroy();
        } catch {
          // ignore
        }
        if (!mountedRef.current) {
          return;
        }
        setStatus('available');
        setStatusText('Gemini Nano 已可用。');
        setDownloadProgress(null);
      })
      .catch(() => {
        if (!mountedRef.current) {
          return;
        }
        setStatus('error');
        setStatusText('Gemini Nano 模型准备失败。');
        setDownloadProgress(null);
      })
      .finally(() => {
        preparingRef.current = false;
        if (mountedRef.current) {
          setIsPreparing(false);
        }
      });
  }, []);

  return { status, statusText, downloadProgress, isPreparing, prepareModel };
}

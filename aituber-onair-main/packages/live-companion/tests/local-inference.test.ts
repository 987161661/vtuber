import { describe, expect, it } from 'vitest';
import {
  AdaptiveLocalInference,
  type LocalInferenceBackend,
  type LocalInferenceSession,
  type LocalModelManifestV1,
  type LocalTensorV1,
} from '../src/index.js';

const manifest: LocalModelManifestV1<number[], number> = {
  id: 'sentiment-v1',
  modelUrl: '/models/sentiment.onnx',
  providers: ['webgpu', 'wasm'],
  encode(input, tensor) {
    return { input: tensor('float32', input, [1, input.length]) };
  },
  decode(outputs) {
    const score = outputs.score?.data[0];
    if (typeof score !== 'number') throw new Error('Missing score output');
    return score;
  },
};

class FakeBackend implements LocalInferenceBackend {
  creates: string[] = [];
  runs = 0;

  constructor(
    private readonly available: { webgpu: boolean; wasm: boolean },
    private readonly failWebGpu = false,
  ) {}

  async capabilities() {
    return this.available;
  }

  tensor(
    type: LocalTensorV1['type'],
    data: readonly number[],
    dims: readonly number[],
  ): LocalTensorV1 {
    return { type, data, dims };
  }

  async createSession(
    _modelUrl: string,
    provider: 'webgpu' | 'wasm',
  ): Promise<LocalInferenceSession> {
    this.creates.push(provider);
    if (provider === 'webgpu' && this.failWebGpu) throw new Error('GPU lost');
    return {
      run: async () => {
        this.runs += 1;
        return {
          score: { type: 'float32', data: [provider === 'webgpu' ? 0.9 : 0.7], dims: [1] },
        };
      },
    };
  }
}

describe('AdaptiveLocalInference', () => {
  it('prefers WebGPU and caches one session per model/provider', async () => {
    const backend = new FakeBackend({ webgpu: true, wasm: true });
    const runtime = new AdaptiveLocalInference(backend);

    const first = await runtime.infer(manifest, [1, 2]);
    const second = await runtime.infer(manifest, [3, 4]);

    expect(first).toMatchObject({ output: 0.9, provider: 'webgpu', modelId: 'sentiment-v1' });
    expect(second.output).toBe(0.9);
    expect(backend.creates).toEqual(['webgpu']);
    expect(backend.runs).toBe(2);
  });

  it('falls back to WASM when WebGPU session creation fails', async () => {
    const backend = new FakeBackend({ webgpu: true, wasm: true }, true);
    const runtime = new AdaptiveLocalInference(backend);

    const result = await runtime.infer(manifest, [1]);

    expect(result).toMatchObject({ output: 0.7, provider: 'wasm' });
    expect(backend.creates).toEqual(['webgpu', 'wasm']);
    expect(runtime.providerFailures()).toMatchObject([
      { modelId: 'sentiment-v1', provider: 'webgpu' },
    ]);
  });

  it('fails clearly when no declared execution provider is available', async () => {
    const runtime = new AdaptiveLocalInference(
      new FakeBackend({ webgpu: false, wasm: false }),
    );

    await expect(runtime.infer(manifest, [1])).rejects.toThrow(
      /no local execution provider/i,
    );
  });
});

export type LocalExecutionProviderV1 = 'webgpu' | 'wasm';
export type LocalTensorTypeV1 =
  | 'float32'
  | 'float64'
  | 'int32'
  | 'int64'
  | 'uint8';

export interface LocalTensorV1 {
  type: LocalTensorTypeV1;
  data: ArrayLike<number | bigint>;
  dims: readonly number[];
}

export interface LocalInferenceSession {
  run(
    feeds: Readonly<Record<string, LocalTensorV1>>,
  ): Promise<Readonly<Record<string, LocalTensorV1>>>;
  release?(): Promise<void> | void;
}

export interface LocalInferenceBackend {
  capabilities(): Promise<Record<LocalExecutionProviderV1, boolean>>;
  tensor(
    type: LocalTensorTypeV1,
    data: readonly number[],
    dims: readonly number[],
  ): LocalTensorV1;
  createSession(
    modelUrl: string,
    provider: LocalExecutionProviderV1,
  ): Promise<LocalInferenceSession>;
}

export interface LocalModelManifestV1<Input, Output> {
  id: string;
  modelUrl: string;
  providers: readonly LocalExecutionProviderV1[];
  encode(
    input: Input,
    tensor: LocalInferenceBackend['tensor'],
  ): Readonly<Record<string, LocalTensorV1>>;
  decode(outputs: Readonly<Record<string, LocalTensorV1>>): Output;
}

export interface LocalInferenceResultV1<Output> {
  modelId: string;
  provider: LocalExecutionProviderV1;
  output: Output;
  latencyMs: number;
}

export interface LocalProviderFailureV1 {
  modelId: string;
  provider: LocalExecutionProviderV1;
  error: unknown;
}

export interface AdaptiveLocalInferenceOptions {
  now?: () => number;
}

/** Generic model-manifest runtime shared by moderation, VAD, intent and embeddings. */
export class AdaptiveLocalInference {
  private readonly sessions = new Map<string, Promise<LocalInferenceSession>>();
  private readonly failures: LocalProviderFailureV1[] = [];
  private readonly backend: LocalInferenceBackend;
  private readonly now: () => number;

  constructor(
    backend: LocalInferenceBackend,
    options: AdaptiveLocalInferenceOptions = {},
  ) {
    this.backend = backend;
    this.now = options.now ?? Date.now;
  }

  async infer<Input, Output>(
    manifest: LocalModelManifestV1<Input, Output>,
    input: Input,
  ): Promise<LocalInferenceResultV1<Output>> {
    validateManifest(manifest);
    const capabilities = await this.backend.capabilities();
    const providers = manifest.providers.filter(
      (provider) => capabilities[provider],
    );
    if (providers.length === 0) {
      throw new Error(
        `No local execution provider is available for ${manifest.id}`,
      );
    }
    const errors: unknown[] = [];
    for (const provider of providers) {
      const startedAt = this.now();
      const key = `${manifest.id}:${provider}`;
      try {
        const session = await this.session(key, manifest.modelUrl, provider);
        const feeds = manifest.encode(
          input,
          this.backend.tensor.bind(this.backend),
        );
        const outputs = await session.run(feeds);
        return {
          modelId: manifest.id,
          provider,
          output: manifest.decode(outputs),
          latencyMs: Math.max(0, this.now() - startedAt),
        };
      } catch (error) {
        errors.push(error);
        this.sessions.delete(key);
        this.failures.push({ modelId: manifest.id, provider, error });
      }
    }
    throw new Error(
      `All local execution providers failed for ${manifest.id}: ${errors
        .map(String)
        .join('; ')}`,
    );
  }

  providerFailures(): LocalProviderFailureV1[] {
    return this.failures.map((failure) => ({ ...failure }));
  }

  async release(): Promise<void> {
    const sessions = await Promise.allSettled(this.sessions.values());
    await Promise.all(
      sessions
        .filter(
          (result): result is PromiseFulfilledResult<LocalInferenceSession> =>
            result.status === 'fulfilled',
        )
        .map(async (result) => result.value.release?.()),
    );
    this.sessions.clear();
  }

  private session(
    key: string,
    modelUrl: string,
    provider: LocalExecutionProviderV1,
  ): Promise<LocalInferenceSession> {
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const created = this.backend.createSession(modelUrl, provider);
    this.sessions.set(key, created);
    return created;
  }
}

/** Real browser adapter. WebGPU code is loaded only when that provider is used. */
export class OnnxRuntimeWebBackend implements LocalInferenceBackend {
  async capabilities(): Promise<Record<LocalExecutionProviderV1, boolean>> {
    const navigatorValue = globalThis.navigator as
      | (Navigator & { gpu?: unknown })
      | undefined;
    return {
      webgpu: navigatorValue?.gpu !== undefined,
      wasm: typeof WebAssembly !== 'undefined',
    };
  }

  tensor(
    type: LocalTensorTypeV1,
    data: readonly number[],
    dims: readonly number[],
  ): LocalTensorV1 {
    return { type, data: toTensorData(type, data), dims: [...dims] };
  }

  async createSession(
    modelUrl: string,
    provider: LocalExecutionProviderV1,
  ): Promise<LocalInferenceSession> {
    const ort =
      provider === 'webgpu'
        ? await import('onnxruntime-web/webgpu')
        : await import('onnxruntime-web');
    const session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: [provider],
    });
    return {
      async run(feeds) {
        const nativeFeeds = Object.fromEntries(
          Object.entries(feeds).map(([name, tensor]) => [
            name,
            new ort.Tensor(
              tensor.type,
              toTensorData(
                tensor.type,
                Array.from(tensor.data, (value) =>
                  typeof value === 'bigint' ? Number(value) : value,
                ),
              ),
              [...tensor.dims],
            ),
          ]),
        );
        const outputs = await session.run(nativeFeeds);
        return Object.fromEntries(
          Object.entries(outputs).map(([name, tensor]) => [
            name,
            {
              type: tensor.type as LocalTensorTypeV1,
              data: tensor.data as ArrayLike<number | bigint>,
              dims: [...tensor.dims],
            },
          ]),
        );
      },
      release: () => session.release(),
    };
  }
}

function validateManifest<Input, Output>(
  manifest: LocalModelManifestV1<Input, Output>,
): void {
  if (!manifest.id || !manifest.modelUrl || manifest.providers.length === 0) {
    throw new Error(
      'Local model manifest requires identity, URL, and providers',
    );
  }
  if (new Set(manifest.providers).size !== manifest.providers.length) {
    throw new Error(
      `Local model manifest has duplicate providers: ${manifest.id}`,
    );
  }
}

function toTensorData(
  type: LocalTensorTypeV1,
  data: readonly number[],
): Float32Array | Float64Array | Int32Array | BigInt64Array | Uint8Array {
  switch (type) {
    case 'float32':
      return Float32Array.from(data);
    case 'float64':
      return Float64Array.from(data);
    case 'int32':
      return Int32Array.from(data);
    case 'int64':
      return BigInt64Array.from(data.map((value) => BigInt(value)));
    case 'uint8':
      return Uint8Array.from(data);
  }
}

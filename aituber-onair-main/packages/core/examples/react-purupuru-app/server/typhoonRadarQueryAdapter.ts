export type TyphoonRadarQueryModule = {
  queryTyphoonRadar: (
    question: string,
    options: { root: string; baseUrl: string },
  ) => Promise<unknown>;
};

export function createTyphoonRadarQueryAdapter(options: {
  loadModule: () => Promise<TyphoonRadarQueryModule>;
  root: string;
  baseUrl: string;
}) {
  let modulePromise: Promise<TyphoonRadarQueryModule> | null = null;

  const getModule = () => {
    if (!modulePromise) {
      modulePromise = options.loadModule().catch((error) => {
        modulePromise = null;
        throw error;
      });
    }
    return modulePromise;
  };

  return async (question: string): Promise<string> => {
    const module = await getModule();
    const payload = await module.queryTyphoonRadar(question, {
      root: options.root,
      baseUrl: options.baseUrl,
    });
    return JSON.stringify(payload);
  };
}

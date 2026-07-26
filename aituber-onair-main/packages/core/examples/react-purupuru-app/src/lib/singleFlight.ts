export function createSingleFlightRunner<T>(
  task: () => Promise<T>,
): () => Promise<T> {
  let active: Promise<T> | null = null;

  return () => {
    if (active) return active;

    let execution: Promise<T>;
    try {
      execution = task();
    } catch (error) {
      execution = Promise.reject(error);
    }

    const tracked = execution.finally(() => {
      if (active === tracked) active = null;
    });
    active = tracked;
    return tracked;
  };
}

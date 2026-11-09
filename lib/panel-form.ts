export interface PanelFormSubmission<T> {
  isMounted: () => boolean;
  evaluate: () => Promise<T>;
  commit: (result: T) => void;
  reset: () => void;
}

/** A completed query owns its result; only its unchanged form owns the reset. */
export function createPanelFormLease() {
  let formRevision = 0;
  let lifetime = 0;
  let activeRequest: object | undefined;

  return {
    invalidate() { formRevision++; },
    dispose() {
      formRevision++;
      lifetime++;
      activeRequest = undefined;
    },
    async submit<T>(submission: PanelFormSubmission<T>): Promise<boolean> {
      if (activeRequest || !submission.isMounted()) return false;
      const request = {};
      const submittedForm = formRevision;
      const submittedLifetime = lifetime;
      activeRequest = request;
      try {
        const result = await submission.evaluate();
        if (!submission.isMounted() || lifetime !== submittedLifetime || activeRequest !== request) return false;
        submission.commit(result);
        if (submission.isMounted() && lifetime === submittedLifetime && activeRequest === request
          && formRevision === submittedForm) submission.reset();
        return true;
      } finally {
        if (activeRequest === request) activeRequest = undefined;
      }
    },
  };
}

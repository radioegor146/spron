export interface BackoffStrategyEnvironment {
  WORKER_BACKOFF_DELAY: number
  WORKER_MAX_ATTEMPTS: number
}

export function backoffStrategy (environment: BackoffStrategyEnvironment): (attemptsMade: number) => number {
  return attemptsMade => {
    if (attemptsMade > environment.WORKER_MAX_ATTEMPTS) {
      return -1
    }
    return environment.WORKER_BACKOFF_DELAY
  }
}

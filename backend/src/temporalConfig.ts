/**
 * Single source of truth for the Temporal connection points and for the timeout/retry
 * budget applied to email verification.
 *
 * The address and task queue used to be duplicated between `index.ts` and `worker.ts`;
 * the workflow tests are the third consumer, so they live here now.
 */

const SECOND = 1000
const MINUTE = 60 * SECOND

export const TEMPORAL_ADDRESS = 'localhost:7233'
export const TEMPORAL_NAMESPACE = 'default'
export const TEMPORAL_TASK_QUEUE = 'myQueue'

/**
 * The slowest third-party verification provider we are still willing to wait for. A
 * provider slower than this is treated as broken rather than slow.
 *
 * `startToCloseTimeout` must stay above this value: if a single attempt cannot fit a
 * provider that does eventually return a correct answer, that answer is thrown away and
 * the activity is retried until it runs out of attempts.
 */
export const SLOWEST_TOLERATED_PROVIDER_LATENCY = 20 * SECOND

/**
 * Every bound below is deliberate. Removing any one of them re-opens the "email
 * verification hangs forever" bug:
 *
 * - `startToCloseTimeout` caps a *single* attempt.
 * - `scheduleToCloseTimeout` caps the *total* elapsed time across every retry. This is the
 *   backstop that guarantees the activity always settles.
 * - `maximumAttempts` must be finite. Temporal's default is `Infinity`, and an unlimited
 *   retry count combined with a too-small `startToCloseTimeout` is precisely what made
 *   verification hang instead of succeeding or failing.
 */
export const VERIFY_EMAIL_ACTIVITY_OPTIONS = {
  startToCloseTimeout: 30 * SECOND,
  scheduleToCloseTimeout: 2 * MINUTE,
  retry: {
    initialInterval: 1 * SECOND,
    backoffCoefficient: 2,
    maximumInterval: 10 * SECOND,
    maximumAttempts: 3,
  },
}

/** Last-resort ceiling on the whole workflow, above the activity's own total budget. */
export const VERIFY_EMAIL_WORKFLOW_EXECUTION_TIMEOUT = 3 * MINUTE

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TestWorkflowEnvironment } from '@temporalio/testing'
import { Worker } from '@temporalio/worker'
import path from 'path'
import { SLOWEST_TOLERATED_PROVIDER_LATENCY, VERIFY_EMAIL_ACTIVITY_OPTIONS } from '../temporalConfig'

const TEST_TASK_QUEUE = 'verify-email-test'
const WORKFLOWS_PATH = path.join(__dirname, 'index.ts')

const SLOW_PROVIDER_EMAIL = 'jane.smith@example.com'
const UNVERIFIABLE_EMAIL = 'john.doe@example.com'

let env: TestWorkflowEnvironment

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping()
}, 120000)

afterAll(async () => {
  await env?.teardown()
})

/**
 * Runs `verifyEmailWorkflow` against a stubbed provider so the real activity's own timing
 * does not decide how long the suite takes. Note that the time-skipping server only skips
 * time while the workflow is waiting on a *timer* (such as retry backoff) — it cannot skip
 * an activity that is still executing, so every stub here settles promptly.
 */
async function runWithProvider(
  verifyEmail: (email: string) => Promise<boolean>,
  { email, workflowId }: { email: string; workflowId: string }
): Promise<boolean> {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TEST_TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities: { verifyEmail },
  })

  return worker.runUntil(
    env.client.workflow.execute('verifyEmailWorkflow', {
      taskQueue: TEST_TASK_QUEUE,
      workflowId,
      args: [email],
    })
  )
}

describe('verifyEmailWorkflow', () => {
  describe('a provider that never returns', () => {
    it('gives up after a bounded number of attempts instead of retrying forever', async () => {
      let attempts = 0

      const promise = runWithProvider(
        async () => {
          attempts += 1
          throw new Error('provider did not respond')
        },
        { email: SLOW_PROVIDER_EMAIL, workflowId: 'verify-email-test-bounded' }
      )

      await expect(promise).rejects.toThrow()
      expect(attempts).toBe(VERIFY_EMAIL_ACTIVITY_OPTIONS.retry.maximumAttempts)
    }, 60000)
  })

  describe('a provider that answers', () => {
    it('resolves true for a verifiable address', async () => {
      const result = await runWithProvider(async () => true, {
        email: 'verified@example.com',
        workflowId: 'verify-email-test-true',
      })

      expect(result).toBe(true)
    }, 60000)

    it('resolves false for an address the provider rejects', async () => {
      const result = await runWithProvider(async () => false, {
        email: UNVERIFIABLE_EMAIL,
        workflowId: 'verify-email-test-false',
      })

      expect(result).toBe(false)
    }, 60000)

    it('does not discard the answer of a provider that is merely slow', async () => {
      const result = await runWithProvider(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return true
        },
        { email: SLOW_PROVIDER_EMAIL, workflowId: 'verify-email-test-slow' }
      )

      expect(result).toBe(true)
    }, 60000)
  })
})

/**
 * The original hang was a *configuration* bug: a 1 second `startToCloseTimeout` with no
 * retry policy, so Temporal's default of unlimited attempts applied. These assertions are
 * what fail loudly if that configuration is ever reinstated.
 */
describe('VERIFY_EMAIL_ACTIVITY_OPTIONS', () => {
  it('caps the number of attempts so retries cannot continue forever', () => {
    expect(VERIFY_EMAIL_ACTIVITY_OPTIONS.retry.maximumAttempts).toBeLessThan(Infinity)
  })

  it('bounds the total time across all retries', () => {
    expect(VERIFY_EMAIL_ACTIVITY_OPTIONS.scheduleToCloseTimeout).toBeGreaterThan(0)
  })

  it('allows a single attempt to outlast the slowest provider we tolerate', () => {
    expect(VERIFY_EMAIL_ACTIVITY_OPTIONS.startToCloseTimeout).toBeGreaterThan(
      SLOWEST_TOLERATED_PROVIDER_LATENCY
    )
  })

  it('leaves room for every attempt within the total budget', () => {
    const { startToCloseTimeout, scheduleToCloseTimeout, retry } = VERIFY_EMAIL_ACTIVITY_OPTIONS

    expect(scheduleToCloseTimeout).toBeGreaterThanOrEqual(startToCloseTimeout * retry.maximumAttempts)
  })
})

import { proxyActivities } from '@temporalio/workflow'
import type * as activities from './activities'
import { VERIFY_EMAIL_ACTIVITY_OPTIONS } from '../temporalConfig'

const { verifyEmail } = proxyActivities<typeof activities>(VERIFY_EMAIL_ACTIVITY_OPTIONS)

export async function verifyEmailWorkflow(email: string): Promise<boolean> {
  return await verifyEmail(email)
}

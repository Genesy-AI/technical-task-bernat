import { NativeConnection, Worker } from '@temporalio/worker'
import * as activities from './workflows/activities'
import { TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, TEMPORAL_TASK_QUEUE } from './temporalConfig'

export async function runTemporalWorker() {
  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  })
  try {
    const worker = await Worker.create({
      connection,
      namespace: TEMPORAL_NAMESPACE,
      taskQueue: TEMPORAL_TASK_QUEUE,
      workflowsPath: require.resolve('./workflows'),
      activities,
    })

    await worker.run()
  } finally {
    await connection.close()
  }
}

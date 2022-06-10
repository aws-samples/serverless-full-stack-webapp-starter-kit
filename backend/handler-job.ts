import { SQSHandler } from 'aws-lambda';
import { sampleJob } from './jobs';
import type { JobHandlerEvent } from './common/jobs';
import { ddb, TableName } from './common/dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

export const handler: SQSHandler = async (event, context) => {
  console.log(event);
  const jobs = event.Records.map((e) => {
    const jobEvent = JSON.parse(e.body) as JobHandlerEvent;
    return processJob(jobEvent);
  });
  await Promise.all(jobs);
};

const processJob = async (event: JobHandlerEvent) => {
  const { jobKey } = event;
  try {
    await updateJobStatus(jobKey, 'running');

    switch (event.jobType) {
      case 'sample':
        await sampleJob(event.payload);
    }

    await updateJobStatus(jobKey, 'completed');
  } catch (err) {
    console.log(err);
    await updateJobStatus(jobKey, 'failed', (err as any).message);
    throw err;
  }
};

const updateJobStatus = async (
  jobKey: { PK: string; SK: string },
  status: 'running' | 'completed' | 'failed',
  reason?: string,
) => {
  await ddb.send(
    new UpdateCommand({
      TableName,
      Key: jobKey,
      UpdateExpression: 'set #status = :status, reason=:reason, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':reason': reason ?? '',
        ':updatedAt': Date.now(),
      },
    }),
  );
};

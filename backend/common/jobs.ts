import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TableName } from 'common/dynamodb';
import type { SampleJobEvent } from 'jobs';

const JobQueueName = process.env.JOB_QUEUE_NAME!;
const sqs = new SQSClient({ region: process.env.AWS_REGION });

export type JobHandlerEvent = {
  jobKey: { PK: string; SK: string };
} & JobEvent;

// You will append new job event types as union
// e.g. type JobEvent = SampleJobEvent | NewJobEvent | AnotherJobEvent
export type JobEvent = SampleJobEvent;

export const runJob = async (userId: string, event: JobEvent) => {
  const now = Date.now();
  const jobId = `JOB#${userId}`;
  await ddb.send(
    new PutCommand({
      TableName,
      Item: {
        PK: jobId,
        SK: `${now}`,
        jobType: event.jobType,
        status: 'pending',
        createdAt: now,
      },
    }),
  );

  const message: JobHandlerEvent = {
    jobKey: { PK: jobId, SK: `${now}` },
    ...event,
  };

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: JobQueueName,
      MessageBody: JSON.stringify(message),
    }),
  );
};

import { Handler } from 'aws-lambda';
import { runJob } from './common/jobs';

export const handler: Handler = async (event, context) => {
  console.log(event);
  await runJob('cron', event);
};

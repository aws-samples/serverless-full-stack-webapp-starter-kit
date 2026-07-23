import { jobPayloadPropsSchema } from '@repo/shared-types/job-payload';
import { translateJobHandler } from './jobs/translate';
import type { Handler } from 'aws-lambda';

export const handler: Handler<unknown> = async (event) => {
  const { data: payload, error } = jobPayloadPropsSchema.safeParse(event);
  if (error) {
    console.error(error);
    throw new Error(error.toString());
  }

  switch (payload.type) {
    case 'translate':
      await translateJobHandler(payload);
      break;
    case 'example':
      console.log('example job processed');
      break;
  }
};

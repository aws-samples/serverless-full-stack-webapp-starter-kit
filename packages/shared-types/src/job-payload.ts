import { z } from 'zod';

export const translateJobSchema = z.object({
  type: z.literal('translate'),
  todoItemId: z.string(),
  userId: z.string(),
});

export const exampleJobSchema = z.object({
  type: z.literal('example'),
});

export const jobPayloadPropsSchema = z.discriminatedUnion('type', [translateJobSchema, exampleJobSchema]);

export type JobPayloadProps = z.infer<typeof jobPayloadPropsSchema>;
export type TranslateJobPayload = z.infer<typeof translateJobSchema>;

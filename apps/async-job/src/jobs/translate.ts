import { sendEvent } from '../events';
import { db } from '@repo/db/client';
import { todoItems } from '@repo/db/schema';
import { eq } from 'drizzle-orm';
import type { TranslateJobPayload } from '@repo/shared-types/job-payload';
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';

export async function translateJobHandler(params: TranslateJobPayload) {
  const todoItem = await db.query.todoItems.findFirst({
    where: eq(todoItems.id, params.todoItemId),
  });
  if (!todoItem) {
    console.log(`item ${params.todoItemId} not found.`);
    return;
  }

  const translateClient = new TranslateClient({
    region: process.env.AWS_REGION || 'ap-northeast-1',
  });

  const targetLanguage = 'ja';
  const translateResult = await translateClient.send(
    new TranslateTextCommand({
      Text: todoItem.title,
      SourceLanguageCode: 'auto',
      TargetLanguageCode: targetLanguage,
    }),
  );

  if (translateResult.TranslatedText) {
    await db.insert(todoItems).values({
      title: translateResult.TranslatedText,
      description: `Translated from: ${todoItem.title} (from ${translateResult.SourceLanguageCode} to ${targetLanguage})`,
      userId: params.userId,
      status: todoItem.status,
    });

    console.log(`Created translated todo item`);
  }

  await sendEvent(`user/${params.userId}/jobs`, { type: 'completed' });
}

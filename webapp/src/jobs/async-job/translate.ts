import { sendEvent } from '@/lib/events';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { TranslateClient, TranslateTextCommand, TranslateTextCommandInput } from '@aws-sdk/client-translate';

export const translateJobSchema = z.object({
  type: z.literal('translate'),
  todoItemId: z.string(),
  userId: z.string(),
});

export const translateJobHandler = async (params: z.infer<typeof translateJobSchema>) => {
  const todoItem = await prisma.todoItem.findUnique({ where: { id: params.todoItemId } });
  if (!todoItem) {
    console.log(`item ${params.todoItemId} not found.`);
    return;
  }

  // Use amazon translate and create a new todoItem record with translated todoItem.title
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
    // Create a new todo item with the translated title
    const translatedTodoItem = await prisma.todoItem.create({
      data: {
        title: translateResult.TranslatedText,
        description: `Translated from: ${todoItem.title} (from ${translateResult.SourceLanguageCode} to ${targetLanguage})`,
        userId: params.userId,
        status: todoItem.status,
      },
    });

    console.log(`Created translated todo item: ${translatedTodoItem.id}`);
  }

  await sendEvent(`user/${params.userId}/jobs`, { type: 'completed' });
};

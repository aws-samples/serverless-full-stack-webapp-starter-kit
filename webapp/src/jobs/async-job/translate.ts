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

  // Translate the title from English to Japanese
  const translateParams: TranslateTextCommandInput = {
    Text: todoItem.title,
    SourceLanguageCode: 'auto',
    TargetLanguageCode: 'ja',
  };

  const translateCommand = new TranslateTextCommand(translateParams);
  const translateResult = await translateClient.send(translateCommand);

  if (translateResult.TranslatedText) {
    // Create a new todo item with the translated title
    const translatedTodoItem = await prisma.todoItem.create({
      data: {
        title: translateResult.TranslatedText,
        description: `Translated from: ${todoItem.title} (detected language: ${translateResult.SourceLanguageCode})`,
        userId: params.userId,
        status: todoItem.status,
      },
    });

    console.log(`Created translated todo item: ${translatedTodoItem.id}`);
  }

  await sendEvent(`${params.userId}/jobs`, { type: 'completed' });
};

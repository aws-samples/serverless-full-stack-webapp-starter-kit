import { CreateMemoRequest, DeleteMemoRequest } from './type';
import { ddb, TableName } from '../../common/dynamodb';
import { Handler } from '../../common/express';
import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { runJob } from 'common/jobs';

export const createMemo: Handler = async (req, res) => {
  const request = req.body as CreateMemoRequest;
  const userId = res.locals.userId as string;
  const now = Date.now()
  const item = {
    PK: pk(userId),
    SK: now.toString(),
    title: request.title,
    content: request.content,
    createdAt: now,
  };
  const response = await ddb.send(
    new PutCommand({
      TableName,
      Item: item,
    }),
  );

  return item;
};

export const getMemos: Handler = async (req, res) => {
  const userId = res.locals.userId as string;
  const memos = await ddb.send(
    new QueryCommand({
      TableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': pk(userId),
      },
      ScanIndexForward: false,
    }),
  );

  return { memos: memos.Items ?? [] };
};

export const deleteMemo: Handler = async (req, res) => {
  const userId = res.locals.userId as string;
  const request = req.body as DeleteMemoRequest;
  await ddb.send(
    new DeleteCommand({
      TableName,
      Key: {
        PK: pk(userId),
        SK: request.sk,
      },
    }),
  );

  return {};
};

export const runSampleJob: Handler = async (req, res) => {
  const userId = res.locals.userId as string;
  await runJob(userId, {
    jobType: 'sample',
    payload: {},
  });
};

const pk = (userId: string) => `MEMO#${userId};`;

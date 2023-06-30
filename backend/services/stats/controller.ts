import { ScanCommand } from '@aws-sdk/client-dynamodb';
import { client, TableName } from '../../common/dynamodb';
import { Handler } from '../../common/express';

export const getStats: Handler = async (req, res) => {
  // You should avoid DynamoDB scan on production. It is used here just for demo purpose.
  const memoCount = await client.send(
    new ScanCommand({
      TableName,
      Select: 'COUNT',
      FilterExpression: 'begins_with(PK, :prefix)',
      ExpressionAttributeValues: {
        ':prefix': { S: 'MEMO' },
      },
    }),
  );

  const jobCount = await client.send(
    new ScanCommand({
      TableName,
      Select: 'COUNT',
      FilterExpression: 'begins_with(PK, :prefix)',
      ExpressionAttributeValues: {
        ':prefix': { S: 'JOB' },
      },
    }),
  );

  return { memoCount: memoCount.Count, jobCount: jobCount.Count };
};

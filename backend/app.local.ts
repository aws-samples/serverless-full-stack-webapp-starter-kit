process.env.TABLE_NAME = 'test';
process.env.AWS_REGION = 'us-east-1';
process.env.DYNAMODB_ENDPOINT = 'http://localhost:8000';
process.env.JOB_QUEUE_NAME = 'dummy';

import { client, TableName } from './common/dynamodb';
import { CreateTableCommand, ResourceInUseException } from '@aws-sdk/client-dynamodb';
import app from './apps/local';

const port = 3001;

// https://github.com/wclr/ts-node-dev/issues/120
process.on('SIGTERM', (err: any) => {
  process.exit(1);
});

const main = async () => {
  try {
    // Initialize the main table
    await client.send(
      new CreateTableCommand({
        TableName,
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      }),
    );
    console.log('Successfully created a DynamoDB table.')
  } catch (e) {
    if (e instanceof ResourceInUseException) {
      // the table is already created.
    } else {
      console.log(`Failure in creating a DynamoDB table ${e}`);
    }
  }

  app.listen(port, () => {
    console.log(`listening at http://localhost:${port}`);
  });
};

main();

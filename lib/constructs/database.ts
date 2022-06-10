import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface DatabaseProps {}

export class Database extends Construct {
  readonly table: Table;
  constructor(scope: Construct, id: string, props?: DatabaseProps) {
    super(scope, id);

    this.table = new Table(this, 'Default', {
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      // Uncomment these lines to use DynamoDB Free tiers when accessing this table.
      // Please read carefully about DynamoDB pricing model when switching to provisioned mode.
      // https://aws.amazon.com/dynamodb/pricing/
      // billingMode: BillingMode.PROVISIONED,
      // readCapacity: 5,
      // writeCapacity: 5,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}

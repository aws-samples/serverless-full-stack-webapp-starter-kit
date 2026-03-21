import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CfnCluster } from 'aws-cdk-lib/aws-dsql';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IGrantable } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class Database extends Construct {
  readonly cluster: CfnCluster;
  readonly endpoint: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const cluster = new CfnCluster(this, 'Cluster', {
      deletionProtectionEnabled: false,
    });
    cluster.applyRemovalPolicy(RemovalPolicy.DESTROY);

    this.cluster = cluster;
    this.endpoint = cluster.attrEndpoint;

    new CfnOutput(this, 'ClusterEndpoint', {
      value: this.endpoint,
    });
  }

  public grantConnect(grantee: IGrantable) {
    grantee.grantPrincipal.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dsql:DbConnectAdmin'],
        resources: [
          `arn:aws:dsql:${Stack.of(this).region}:${Stack.of(this).account}:cluster/${this.cluster.attrIdentifier}`,
        ],
      }),
    );
  }

  public getLambdaEnvironment() {
    return {
      DSQL_ENDPOINT: this.endpoint,
    };
  }
}

import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CfnCluster } from 'aws-cdk-lib/aws-dsql';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface DatabaseProps {
  /**
   * Removal policy for the DSQL cluster.
   *
   * @default RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE
   */
  readonly removalPolicy?: RemovalPolicy;

  /**
   * Whether to enable deletion protection.
   *
   * @default false
   */
  readonly deletionProtectionEnabled?: boolean;
}

export class Database extends Construct {
  readonly cluster: CfnCluster;
  readonly endpoint: string;

  constructor(scope: Construct, id: string, props: DatabaseProps = {}) {
    super(scope, id);

    const { removalPolicy = RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE, deletionProtectionEnabled = false } = props;

    const cluster = new CfnCluster(this, 'Cluster', {
      deletionProtectionEnabled,
      tags: [{ key: 'Name', value: `${Stack.of(this).stackName}-dsql` }],
    });
    cluster.applyRemovalPolicy(removalPolicy);

    this.cluster = cluster;
    this.endpoint = cluster.attrEndpoint;

    new CfnOutput(this, 'ClusterEndpoint', {
      value: this.endpoint,
    });
  }

  /**
   * Grant DML-only connect permission (dsql:DbConnect) for application workloads.
   * Requires a custom database role created via migration. See ADR-004.
   * TODO: Migrate webapp/async-job to use this method with a custom DB role.
   */
  public grantConnect(grantee: IGrantable): Grant {
    return Grant.addToPrincipal({
      grantee,
      actions: ['dsql:DbConnectAdmin'],
      resourceArns: [
        `arn:aws:dsql:${Stack.of(this).region}:${Stack.of(this).account}:cluster/${this.cluster.attrIdentifier}`,
      ],
    });
  }
}

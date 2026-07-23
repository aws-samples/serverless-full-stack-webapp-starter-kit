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
   * Grant connect permission to the DSQL cluster.
   *
   * v3 uses the built-in `admin` role for all workloads (webapp, async-job,
   * migrator), so this grants `dsql:DbConnectAdmin`. See ADR-004 for why the
   * admin role is retained in v3.
   * TODO: introduce a custom DB role (created via migration) and switch the
   * application workloads to DML-only `dsql:DbConnect`, keeping admin for the migrator.
   */
  public grantConnect(grantee: IGrantable): Grant {
    return Grant.addToPrincipal({
      grantee,
      actions: ['dsql:DbConnectAdmin'],
      resourceArns: [
        Stack.of(this).formatArn({
          service: 'dsql',
          resource: 'cluster',
          resourceName: this.cluster.attrIdentifier,
        }),
      ],
    });
  }
}

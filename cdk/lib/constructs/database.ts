import { CfnOutput, Stack, Token } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

interface DatabaseProps {
  vpc: ec2.IVpc;
}

export class Database extends Construct implements ec2.IConnectable {
  readonly cluster: rds.DatabaseCluster;
  readonly secret: secretsmanager.ISecret;
  readonly connections: ec2.Connections;

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);

    const vpc = props.vpc;

    const engine = rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_6 });
    const cluster = new rds.DatabaseCluster(this, 'Cluster', {
      engine,
      writer: rds.ClusterInstance.serverlessV2('Writer', {
        enablePerformanceInsights: true,
        autoMinorVersionUpgrade: true,
      }),
      serverlessV2MinCapacity: 0,
      vpc,
      vpcSubnets: vpc.selectSubnets({ subnets: vpc.isolatedSubnets.concat(vpc.privateSubnets) }),
      storageEncrypted: true,
      // Exclude some more special characters from password string to avoid from URI encoding issue
      // see: https://www.prisma.io/docs/orm/reference/connection-urls#special-characters
      credentials: rds.Credentials.fromUsername(engine.defaultUsername ?? 'admin', {
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\,=^',
      }),
      parameterGroup: new rds.ParameterGroup(this, 'ParameterGroup', {
        engine,
        parameters: {
          // Close idle connection after 60 seconds for Aurora auto-pause
          idle_session_timeout: '60000',
        },
      }),
    });

    this.cluster = cluster;
    this.secret = cluster.secret!;
    this.connections = this.cluster.connections;

    const host = new ec2.BastionHostLinux(this, 'BastionHost', {
      vpc,
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      blockDevices: [
        {
          deviceName: '/dev/sdf',
          volume: ec2.BlockDeviceVolume.ebs(8, {
            encrypted: true,
          }),
        },
      ],
    });
    this.connections.allowDefaultPortFrom(host);

    new CfnOutput(this, 'PortForwardCommand', {
      value: `aws ssm start-session --region ${Stack.of(this).region} --target ${
        host.instanceId
      } --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters '{"portNumber":["${
        cluster.clusterEndpoint.port
      }"], "localPortNumber":["${cluster.clusterEndpoint.port}"], "host": ["${cluster.clusterEndpoint.hostname}"]}'`,
    });
    new CfnOutput(this, 'DatabaseSecretsCommand', {
      value: `aws secretsmanager get-secret-value --secret-id ${cluster.secret!.secretName} --region ${
        Stack.of(this).region
      }`,
    });
  }

  public getConnectionInfo() {
    return {
      // We use direct reference for host and port because using only secret here results in failure of refreshing values.
      // Also refer to: https://github.com/aws-cloudformation/cloudformation-coverage-roadmap/issues/369
      host: this.cluster.clusterEndpoint.hostname,
      port: Token.asString(this.cluster.clusterEndpoint.port),
      engine: this.secret.secretValueFromJson('engine').unsafeUnwrap(),
      username: this.secret.secretValueFromJson('username').unsafeUnwrap(),
      password: this.secret.secretValueFromJson('password').unsafeUnwrap(),
    };
  }

  public getLambdaEnvironment(databaseName: string) {
    const conn = this.getConnectionInfo();
    // Aurora Serverless v2 cold start takes up to 15 seconds
    // https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool
    const option = '?pool_timeout=20&connect_timeout=20';
    return {
      DATABASE_HOST: conn.host,
      DATABASE_NAME: databaseName,
      DATABASE_USER: conn.username,
      DATABASE_PASSWORD: conn.password,
      DATABASE_ENGINE: conn.engine,
      DATABASE_PORT: conn.port,
      DATABASE_OPTION: option,
      DATABASE_URL: `${conn.engine}://${conn.username}:${conn.password}@${conn.host}:${conn.port}/${databaseName}${option}`,
    };
  }
}

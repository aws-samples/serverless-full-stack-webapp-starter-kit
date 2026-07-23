// Dev DSQL cluster management CLI
//
// Usage:
//   pnpm --filter @repo/db run cluster create [--region REGION]
//   pnpm --filter @repo/db run cluster delete [--region REGION]
//   pnpm --filter @repo/db run cluster status [--region REGION]
//
// After creation, DSQL_ENDPOINT and AWS_REGION are written to packages/db/.env.

import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  DSQLClient,
  CreateClusterCommand,
  DeleteClusterCommand,
  GetClusterCommand,
  waitUntilClusterActive,
} from '@aws-sdk/client-dsql';

const ENV_PATH = join(import.meta.dirname, '..', '.env');

function parseArgs(args: string[]): { command: string; region: string } {
  const command = args[0] ?? 'help';
  let region = process.env.AWS_REGION ?? 'us-east-1';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--region' && args[i + 1]) {
      region = args[++i];
    }
  }
  return { command, region };
}

function readClusterId(): string | undefined {
  if (!existsSync(ENV_PATH)) return undefined;
  const match = readFileSync(ENV_PATH, 'utf-8').match(/^DSQL_ENDPOINT=([^.]+)/m);
  return match?.[1];
}

function writeEnv(endpoint: string, region: string) {
  writeFileSync(ENV_PATH, `DSQL_ENDPOINT=${endpoint}\nAWS_REGION=${region}\n`);
}

function getOwner(): string {
  return execSync('whoami', { encoding: 'utf-8' }).trim();
}

async function create(client: DSQLClient, region: string) {
  // Idempotent: skip if an ACTIVE/CREATING cluster already exists
  const existing = readClusterId();
  if (existing) {
    try {
      const { status: clusterStatus } = await client.send(new GetClusterCommand({ identifier: existing }));
      if (clusterStatus === 'ACTIVE' || clusterStatus === 'CREATING') {
        console.log(`Cluster already exists: ${existing} (${clusterStatus})`);
        return;
      }
      console.log(`Previous cluster ${existing} is ${clusterStatus}, creating new one...`);
    } catch {
      // Cluster not found — proceed to create
    }
  }

  console.log(`Creating DSQL cluster in ${region}...`);
  const res = await client.send(
    new CreateClusterCommand({
      deletionProtectionEnabled: false,
      tags: {
        Application: 'ServerlessWebappStarterKit',
        ManagedBy: 'cluster-cli',
        Owner: getOwner(),
        Name: 'ServerlessWebappStarterKit-dsql-dev',
      },
    }),
  );

  const endpoint = res.endpoint!;
  const identifier = res.identifier!;
  writeEnv(endpoint, region);
  console.log(`Cluster created: ${identifier}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Written to: .env`);

  console.log('\nWaiting for ACTIVE status...');
  await waitUntilClusterActive({ client, maxWaitTime: 300 }, { identifier });
  console.log('Cluster is ACTIVE');

  console.log('\nRun schema migration:');
  console.log('  pnpm --filter @repo/db run migrate');
}

async function del(client: DSQLClient) {
  const clusterId = readClusterId();
  if (!clusterId) {
    console.error('No cluster found in .env');
    process.exit(1);
  }
  console.log(`Deleting cluster: ${clusterId}`);
  await client.send(new DeleteClusterCommand({ identifier: clusterId }));
  unlinkSync(ENV_PATH);
  console.log('Cluster deleted and .env removed');
}

async function status(client: DSQLClient) {
  const clusterId = readClusterId();
  if (!clusterId) {
    console.error('No cluster found in .env');
    process.exit(1);
  }
  const cluster = await client.send(new GetClusterCommand({ identifier: clusterId }));
  console.log(`Identifier: ${cluster.identifier}`);
  console.log(`Status:     ${cluster.status}`);
  console.log(`Endpoint:   ${cluster.endpoint}`);
}

async function main() {
  const { command, region } = parseArgs(process.argv.slice(2));

  if (command === 'help') {
    console.log('Usage: cluster {create|delete|status} [--region REGION]');
    return;
  }

  const client = new DSQLClient({ region });

  switch (command) {
    case 'create':
      return create(client, region);
    case 'delete':
      return del(client);
    case 'status':
      return status(client);
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

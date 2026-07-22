import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MainStack } from '../lib/main-stack';
import { UsEast1Stack } from '../lib/us-east-1-stack';

const repoRoot = path.join(__dirname, '..', '..', '..');
const migrationsDir = path.join(repoRoot, 'packages', 'db', 'migrations');
const outdir = path.join(os.tmpdir(), 'serverless-full-stack-webapp-starter-kit-dsql-migrator-test');

function synthMain(): Template {
  // AssetStaging caches by bundling configuration within a Node process. Clear both
  // its cache and the fixed test assembly so this models two separate `cdk synth` runs.
  cdk.AssetStaging.clearAssetHashCache();
  fs.rmSync(outdir, { recursive: true, force: true });

  const app = new cdk.App({ outdir });
  const virginia = new UsEast1Stack(app, 'VirginiaStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    crossRegionReferences: true,
  });
  const main = new MainStack(app, 'RegressionStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    crossRegionReferences: true,
    signPayloadHandler: virginia.signPayloadHandler,
    webAclId: virginia.webAclArn,
  });
  app.synth();
  return Template.fromStack(main);
}

function findMigratorFunction(template: Template) {
  const migrationRunner = Object.entries(template.findResources('AWS::Lambda::Function')).find(([logicalId]) =>
    logicalId.includes('DsqlMigratorHandler'),
  );
  expect(migrationRunner).toBeDefined();
  return migrationRunner!;
}

function findMigratorVersion(template: Template) {
  const migrationVersion = Object.entries(template.findResources('AWS::Lambda::Version')).find(([logicalId]) =>
    logicalId.includes('DsqlMigratorHandlerCurrentVersion'),
  );
  expect(migrationVersion).toBeDefined();
  return migrationVersion!;
}

function findMigratorTrigger(template: Template) {
  const migrationTrigger = Object.entries(template.findResources('Custom::Trigger')).find(([logicalId]) =>
    logicalId.includes('DsqlMigratorTrigger'),
  );
  expect(migrationTrigger).toBeDefined();
  return migrationTrigger!;
}

describe('DsqlMigrator deployment contracts (issue #229)', () => {
  beforeEach(() => {
    fs.rmSync(outdir, { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(outdir, { recursive: true, force: true });
  });

  test('packages the migrator as a zip Lambda asset', () => {
    const [, migrationRunner] = findMigratorFunction(synthMain());

    expect(migrationRunner.Properties.PackageType).toBeUndefined();
    expect(migrationRunner.Properties.Code).toEqual(
      expect.objectContaining({ S3Bucket: expect.anything(), S3Key: expect.anything() }),
    );
    expect(migrationRunner.Properties.Code.ImageUri).toBeUndefined();
  });

  test('the trigger invokes the migrator current version', () => {
    const template = synthMain();
    const [versionLogicalId] = findMigratorVersion(template);
    const [, migrationTrigger] = findMigratorTrigger(template);

    expect(JSON.stringify(migrationTrigger.Properties.HandlerArn)).toContain(versionLogicalId);
  });

  test('keeps migration timeout below trigger timeout below Lambda maximum', () => {
    const template = synthMain();
    const [, migrationRunner] = findMigratorFunction(template);
    const [, migrationTrigger] = findMigratorTrigger(template);
    const migrationTimeout = migrationRunner.Properties.Timeout as number;
    const triggerTimeout = Number(migrationTrigger.Properties.Timeout);

    expect(migrationTimeout).toBe(780);
    expect(triggerTimeout).toBe(840_000);
    expect(migrationTimeout * 1_000).toBeLessThan(triggerTimeout);
    expect(triggerTimeout).toBeLessThan(900_000);
  });

  test('changes the current version when a migration changes', () => {
    const before = synthMain();
    const [versionBefore] = findMigratorVersion(before);
    const addedMigration = path.join(migrationsDir, '.dsql-migrator-synth-contract.sql');

    fs.writeFileSync(addedMigration, '-- temporary asset-hash contract fixture\n');
    try {
      const after = synthMain();
      const [versionAfter] = findMigratorVersion(after);

      expect(versionAfter).not.toBe(versionBefore);
    } finally {
      fs.rmSync(addedMigration, { force: true });
    }
  });

  test('makes the trigger depend on the DSQL cluster', () => {
    const template = synthMain();
    const [clusterLogicalId] = Object.keys(template.findResources('AWS::DSQL::Cluster'));
    const [, migrationTrigger] = findMigratorTrigger(template);

    expect(clusterLogicalId).toBeDefined();
    expect(migrationTrigger.DependsOn).toContain(clusterLogicalId);
  });
});

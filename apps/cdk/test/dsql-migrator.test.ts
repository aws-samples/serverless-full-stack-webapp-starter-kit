import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MainStack } from '../lib/main-stack';
import { UsEast1Stack } from '../lib/us-east-1-stack';

/**
 * Regression tests for issue #229 — the container-image cold-init race between the
 * migrator's `AWS::Lambda::Function` and its downstream `Custom::Trigger`. These
 * invariants come from the fix in the DsqlMigrator construct:
 *  - A published `AWS::Lambda::Version` exists — its PublishVersion call waits for
 *    the function to reach `LastUpdateStatus=Successful`, and the Trigger's
 *    `HandlerArn` (= `handler.currentVersion.functionArn`) implicitly depends on
 *    that Version, so CFN can't fire the Trigger until the new image is loaded.
 *  - The Trigger custom resource carries `ExecutionHash` so re-fires are explicit.
 *  - The Trigger's own timeout (14 min) is bounded strictly below the Lambda
 *    provider's ceiling (15 min) and strictly above the migrator's own timeout
 *    (13 min). This tiering guarantees that a hung migration surfaces before the
 *    trigger provider itself hits its ceiling.
 */
describe('DsqlMigrator race-fix invariants (issue #229)', () => {
  function synthMain(): Template {
    const app = new cdk.App();
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
    return Template.fromStack(main);
  }

  test('the migrator Lambda has a published Version (sync barrier for CFN Trigger)', () => {
    const template = synthMain();
    // Exactly one AWS::Lambda::Version for the migrator handler. If this drops to 0,
    // the container-init race described in issue #229 will re-open.
    const versions = template.findResources('AWS::Lambda::Version');
    const migratorVersion = Object.entries(versions).find(([logicalId]) => logicalId.includes('DsqlMigratorHandler'));
    expect(migratorVersion).toBeDefined();
  });

  test('the Custom::Trigger references the migrator Version ARN (implicit wait)', () => {
    const template = synthMain();
    const triggers = template.findResources('Custom::Trigger');
    const migratorTriggers = Object.entries(triggers).filter(([logicalId]) =>
      logicalId.includes('DsqlMigratorTrigger'),
    );
    expect(migratorTriggers).toHaveLength(1);

    const [, triggerResource] = migratorTriggers[0];
    // HandlerArn must resolve to a Version ARN, not the raw function ARN. If CDK
    // Trigger stops using `handler.currentVersion.functionArn`, we lose the sync
    // barrier and the race returns.
    const handlerArn = triggerResource.Properties.HandlerArn as unknown;
    expect(JSON.stringify(handlerArn)).toContain('DsqlMigratorHandlerCurrentVersion');
  });

  test('the Custom::Trigger carries a MigrationHash for explicit re-fire', () => {
    const template = synthMain();
    const triggers = template.findResources('Custom::Trigger');
    const migratorTriggers = Object.entries(triggers).filter(([logicalId]) =>
      logicalId.includes('DsqlMigratorTrigger'),
    );
    const [, triggerResource] = migratorTriggers[0];
    // MigrationHash is a plain string SHA-256 (64 hex chars). We only assert the shape
    // to avoid coupling the test to actual runtime input contents.
    const migrationHash = triggerResource.Properties.MigrationHash as unknown;
    expect(typeof migrationHash).toBe('string');
    expect(migrationHash as string).toMatch(/^[a-f0-9]{64}$/);
  });

  test('timeout tiering: migrator < trigger invocation < Lambda ceiling', () => {
    const template = synthMain();

    const functions = template.findResources('AWS::Lambda::Function');
    const migratorFn = Object.entries(functions).find(([logicalId]) => logicalId.includes('DsqlMigratorHandler'));
    expect(migratorFn).toBeDefined();
    const migratorTimeout = migratorFn![1].Properties.Timeout as number;
    // 13 minutes chosen so a hung migration surfaces inside the 14-min Trigger timeout.
    expect(migratorTimeout).toBe(13 * 60);

    const triggers = template.findResources('Custom::Trigger');
    const migratorTrigger = Object.entries(triggers).find(([logicalId]) => logicalId.includes('DsqlMigratorTrigger'));
    const triggerTimeout = Number(migratorTrigger![1].Properties.Timeout);
    // Trigger 14 min = 1 min headroom above the migrator, 1 min below the 15-min ceiling.
    expect(triggerTimeout).toBe(14 * 60 * 1000);
    expect(triggerTimeout).toBeGreaterThan(migratorTimeout * 1000);
    // Cannot exceed AWS Lambda's absolute maximum per-invocation timeout.
    expect(triggerTimeout).toBeLessThan(15 * 60 * 1000);
  });
});

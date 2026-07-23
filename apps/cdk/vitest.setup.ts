import { expect } from 'vitest';
import snapshotSerializer from './test/snapshot-plugin';

// Redacts non-deterministic asset hashes / bucket names from CloudFormation snapshots.
expect.addSnapshotSerializer(snapshotSerializer);

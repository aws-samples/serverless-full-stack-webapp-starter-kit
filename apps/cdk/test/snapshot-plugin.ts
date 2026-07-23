// pretty-format plugin: redacts non-deterministic strings (asset hashes, bucket
// names, Lambda version logical-id suffixes) so CloudFormation snapshots are stable.
const snapshotSerializer = {
  test: (val: unknown): val is string => typeof val === 'string',
  serialize: (val: string): string =>
    `"${val //
      .replace(/([A-Fa-f0-9]{64}.zip)/, 'REDACTED')
      .replace(/([A-Fa-f0-9]{64}.mjs)/, 'REDACTED')
      .replace(/.*cdk-hnb659fds-container-assets-.*/, 'REDACTED')
      .replace(/webapp-starter-[0-9a-z]*/, 'REDACTED')
      .replace(/(.*CurrentVersion).*/, '$1REDACTED')}"`,
};

export default snapshotSerializer;

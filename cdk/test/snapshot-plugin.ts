module.exports = {
  test: (val: any) => typeof val === 'string',
  serialize: (val: string) => {
    return `"${val //
      .replace(/([A-Fa-f0-9]{64}.zip)/, 'REDACTED')
      .replace(/([A-Fa-f0-9]{64}.mjs)/, 'REDACTED')
      .replace(/.*cdk-hnb659fds-container-assets-.*/, 'REDACTED')
      .replace(/webapp-starter-[0-9a-z]*/, 'REDACTED')
      .replace(/(.*CurrentVersion).*/, '$1REDACTED')}"`;
  },
};

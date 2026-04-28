/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  // CDK constructs synthesize big trees; bump default 5s.
  testTimeout: 30000,
};

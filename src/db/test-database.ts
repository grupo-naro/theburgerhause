/** Helpers shared by the vitest integration config and its global setup. */
export const TEST_DB_NAME = "burgerhause_test";

/** Same server and credentials as `serverUrl`, but pointing at the test database. */
export function testDatabaseUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

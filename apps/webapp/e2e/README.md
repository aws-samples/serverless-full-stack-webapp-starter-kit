# Playwright E2E tests

This suite validates the deployed webapp through CloudFront, Cognito Managed Login, Aurora DSQL, and AppSync Events. It never starts a local Next.js server.

## Prerequisites

```sh
pnpm install
pnpm exec playwright install --with-deps chromium # run once
```

Test runs and cleanup require every variable below except `E2E_USER_POOL_CLIENT_ID`. `E2E_BASE_URL` must not have a trailing slash.

| Variable                  | Description                                                           |
| ------------------------- | --------------------------------------------------------------------- |
| `E2E_BASE_URL`            | CloudFront frontend URL, e.g. `https://web.example.com`               |
| `E2E_USER_POOL_ID`        | Cognito user pool ID                                                  |
| `E2E_USER_POOL_CLIENT_ID` | Reserved for future use; not consumed by the current suite            |
| `E2E_AWS_REGION`          | Region containing the Cognito user pool                               |
| `E2E_USER_A_EMAIL`        | E2E User A email (also used as Cognito username on email-alias pools) |
| `E2E_USER_A_PASSWORD`     | E2E User A password                                                   |
| `E2E_USER_B_EMAIL`        | E2E User B email (also used as Cognito username on email-alias pools) |
| `E2E_USER_B_PASSWORD`     | E2E User B password                                                   |

## Provision and run

The provisioning command uses the default AWS credentials and emits shell exports to stdout. Do not commit or log the generated passwords.

```sh
eval "$(pnpm run provision:e2e --silent)"
pnpm run test:e2e
pnpm run cleanup:e2e
```

To view the local report after a run:

```sh
pnpm exec playwright show-report
```

## Scenarios

Each row is one test file. `E04` covers the full Todo lifecycle (create → edit → toggle status → delete) as a single scenario; `.kiro/specs/v3-release-prep/08-deploy-verification.md` labels the four state transitions inside it as `E04`–`E07` for traceability.

| Scenario                                                    | Spec IDs | File                             |
| ----------------------------------------------------------- | -------- | -------------------------------- |
| Health endpoint returns HTTP 200 and plaintext `ok`         | E01      | `tests/health.spec.ts`           |
| Unauthenticated `/` redirects to `/sign-in`                 | E02      | `tests/unauth-redirect.spec.ts`  |
| Sign-in via Cognito Managed Login (idempotent on repeat)    | E03      | `tests/sign-in.spec.ts`          |
| Todo lifecycle (create / edit / toggle status / delete)     | E04–E07  | `tests/todo-lifecycle.spec.ts`   |
| Async translation delivered via AppSync Events (no reload)  | E08      | `tests/translate.spec.ts`        |
| Sign-out invalidates access on the current and new contexts | E09      | `tests/sign-out.spec.ts`         |
| Tenant isolation between two users                          | E10      | `tests/tenant-isolation.spec.ts` |

## Known brittleness

- Cognito Managed Login DOM selectors are not a public AWS contract and may need updating.
- E08 waits for the AppSync subscription before requesting translation; asynchronous delivery can still take time.
- Todo deletion uses Playwright's native-dialog handler for the browser `confirm()` prompt.

## CI readiness

The suite is environment-variable driven. User provisioning is a separate script, storage states under `e2e/.auth/` are gitignored, and HTML reports plus failure traces/screenshots/videos are configured for future artifact upload in the #127 workflow.

## 2024-03-01 - Missing Authorization in Nested Deletions (IDOR)
**Vulnerability:** The `deleteTest` server action deleted child records (`metrics_daily`, `test_periods`, `variants`) using only the provided `testId` without verifying that the parent test belonged to the requesting user.
**Learning:** Even when endpoints require authentication, operations on child entities must always verify ownership of the parent entity to prevent Insecure Direct Object Reference (IDOR) attacks.
**Prevention:** Use subqueries to validate ownership before deleting or modifying child records, e.g., `where test_id in (select id from tests where id = $1 and user_id = $2)`.
## 2024-10-24 - Hardcoded Fallback Encryption Key

**Vulnerability:** A hardcoded key `"ozon-ab-preview-local-key"` was included in the `secretsToTry` fallback list, meaning that if production environments forgot to set `ENCRYPTION_KEY` or `BETTER_AUTH_SECRET`, the app would silently fallback to encrypting sensitive shop credentials (API keys) using this public, hardcoded key.

**Learning:** Fallback secrets meant for local preview/development must strictly be omitted in production environments to avoid silent downgrade attacks or accidental misconfigurations from causing critical data exposure.

**Prevention:** Only push hardcoded fallback keys when `process.env.NODE_ENV !== "production"`. Throw explicit errors when cryptographic functions lack valid keys in production rather than attempting to proceed ("fail securely").

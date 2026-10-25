## 2024-03-01 - Missing Authorization in Nested Deletions (IDOR)
**Vulnerability:** The `deleteTest` server action deleted child records (`metrics_daily`, `test_periods`, `variants`) using only the provided `testId` without verifying that the parent test belonged to the requesting user.
**Learning:** Even when endpoints require authentication, operations on child entities must always verify ownership of the parent entity to prevent Insecure Direct Object Reference (IDOR) attacks.
**Prevention:** Use subqueries to validate ownership before deleting or modifying child records, e.g., `where test_id in (select id from tests where id = $1 and user_id = $2)`.
## 2026-10-25 - Missing Authorization in Nested Deletions/Updates (IDOR)
**Vulnerability:** The `updateVariantImages`, `rotateTest`, `stopTest`, and `collectMetricsForTest` actions updated or deleted child records (`variants`, `test_periods`, `metrics_daily`) using only the provided `testId` without verifying that the parent test belonged to the requesting user.
**Learning:** Even when endpoints require authentication, operations on child entities must always verify ownership of the parent entity to prevent Insecure Direct Object Reference (IDOR) attacks.
**Prevention:** Use subqueries to validate ownership before deleting or modifying child records, e.g., `where test_id in (select id from tests where id = $1 and user_id = $2)`.

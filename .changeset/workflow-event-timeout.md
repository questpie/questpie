---
"@questpie/workflows": patch
---

Schedule waitForEvent deadlines and resume with null when no event arrives. An event that completes the wait invalidates its pending timeout, and competing event/timeout deliveries claim the waiting step atomically so the winner's result cannot be overwritten. Maintenance recovers missing deadline jobs.

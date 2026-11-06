"use strict";window.EX=window.EX||{},window.EX.logs={file:"server-logs.txt",raw:`2026-10-23T14:00:00Z ERR upstream timed out after 30s while reading response from worker
2026-10-23T14:00:07Z WARN token expired for user 3192
2026-10-23T14:00:14Z ERR invalid signature on webhook from search
2026-10-23T14:00:21Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T14:01:28Z WARN 401 Unauthorized: missing bearer token
2026-10-23T14:01:35Z ERR read ECONNRESET from api after 30000ms
2026-10-23T14:01:42Z ERR no space left on device /var/lib/worker
2026-10-23T14:01:49Z ERR read ECONNRESET from search after 30000ms
2026-10-23T14:02:56Z INFO cache warmed in 840ms
2026-10-23T14:02:03Z ERR failed to write segment: ENOSPC
2026-10-23T14:02:10Z ERR OAuth refresh failed for org 4814: invalid_grant
2026-10-23T14:02:17Z WARN token expired for user 2479
2026-10-23T14:03:24Z ERR OAuth refresh failed for org 2362: invalid_grant
2026-10-23T14:03:31Z ERR read ECONNRESET from search after 30000ms
2026-10-23T14:03:38Z ERR OAuth refresh failed for org 7466: invalid_grant
2026-10-23T14:03:45Z ERR upstream timed out after 30s while reading response from api
2026-10-23T14:04:52Z WARN token expired for user 7082
2026-10-23T14:04:59Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:04:06Z ERR invalid signature on webhook from worker
2026-10-23T14:04:13Z ERR upstream timed out after 30s while reading response from gateway
2026-10-23T14:05:20Z ERR context deadline exceeded calling worker.internal
2026-10-23T14:05:27Z WARN 401 Unauthorized: missing bearer token
2026-10-23T14:05:34Z ERR read ECONNRESET from gateway after 30000ms
2026-10-23T14:05:41Z ERR read ECONNRESET from search after 30000ms
2026-10-23T14:06:48Z WARN inode usage 97% on /tmp
2026-10-23T14:06:55Z ERR OAuth refresh failed for org 4211: invalid_grant
2026-10-23T14:06:02Z WARN disk usage 94% on volume data-5124
2026-10-23T14:06:09Z INFO deploy finished for api v2.7521
2026-10-23T14:07:16Z ERR upstream timed out after 30s while reading response from gateway
2026-10-23T14:07:23Z ERR too many connections (max 100) on primary db
2026-10-23T14:07:30Z ERR upstream timed out after 30s while reading response from worker
2026-10-23T14:07:37Z ERR context deadline exceeded calling gateway.internal
2026-10-23T14:08:44Z WARN token expired for user 6108
2026-10-23T14:08:51Z ERR invalid signature on webhook from billing
2026-10-23T14:08:58Z ERR upstream timed out after 30s while reading response from search
2026-10-23T14:08:05Z ERR no space left on device /var/lib/billing
2026-10-23T14:09:12Z ERR OAuth refresh failed for org 394: invalid_grant
2026-10-23T14:09:19Z ERR deadlock detected on table invoices
2026-10-23T14:09:26Z WARN 401 Unauthorized: missing bearer token
2026-10-23T14:09:33Z WARN disk usage 94% on volume data-7738
2026-10-23T14:10:40Z INFO cache warmed in 840ms
2026-10-23T14:10:47Z WARN inode usage 97% on /tmp
2026-10-23T14:10:54Z ERR upstream timed out after 30s while reading response from worker
2026-10-23T14:10:01Z ERR read ECONNRESET from billing after 30000ms
2026-10-23T14:11:08Z WARN disk usage 94% on volume data-6540
2026-10-23T14:11:15Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T14:11:22Z WARN disk usage 94% on volume data-8913
2026-10-23T14:11:29Z WARN feature flag new_checkout missing, using default
2026-10-23T14:12:36Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:12:43Z ERR upstream timed out after 30s while reading response from worker
2026-10-23T14:12:50Z ERR read ECONNRESET from gateway after 30000ms
2026-10-23T14:12:57Z ERR failed to write segment: ENOSPC
2026-10-23T14:13:04Z WARN inode usage 97% on /tmp
2026-10-23T14:13:11Z WARN disk usage 94% on volume data-4688
2026-10-23T14:13:18Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:13:25Z WARN token expired for user 2259
2026-10-23T14:14:32Z INFO cron job nightly-report completed
2026-10-23T14:14:39Z ERR OAuth refresh failed for org 247: invalid_grant
2026-10-23T14:14:46Z INFO cron job nightly-report completed
2026-10-23T14:14:53Z WARN disk usage 94% on volume data-6107
2026-10-23T14:15:00Z ERR OAuth refresh failed for org 2890: invalid_grant
2026-10-23T14:15:07Z ERR context deadline exceeded calling auth.internal
2026-10-23T14:15:14Z WARN feature flag new_checkout missing, using default
2026-10-23T14:15:21Z ERR upstream timed out after 30s while reading response from worker
2026-10-23T14:16:28Z INFO cache warmed in 840ms
2026-10-23T14:16:35Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:16:42Z WARN 401 Unauthorized: missing bearer token
2026-10-23T14:16:49Z ERR context deadline exceeded calling search.internal
2026-10-23T14:17:56Z ERR context deadline exceeded calling worker.internal
2026-10-23T14:17:03Z WARN 401 Unauthorized: missing bearer token
2026-10-23T14:17:10Z ERR no space left on device /var/lib/auth
2026-10-23T14:17:17Z ERR upstream timed out after 30s while reading response from auth
2026-10-23T14:18:24Z WARN token expired for user 6046
2026-10-23T14:18:31Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:18:38Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T14:18:45Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:19:52Z ERR context deadline exceeded calling search.internal
2026-10-23T14:19:59Z INFO cache warmed in 840ms
2026-10-23T14:19:06Z ERR OAuth refresh failed for org 9490: invalid_grant
2026-10-23T14:19:13Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:20:20Z ERR upstream timed out after 30s while reading response from api
2026-10-23T14:20:27Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T14:20:34Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T14:20:41Z WARN inode usage 97% on /tmp
2026-10-23T14:21:48Z ERR deadlock detected on table invoices
2026-10-23T14:21:55Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:21:02Z ERR no space left on device /var/lib/auth
2026-10-23T14:21:09Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:22:16Z WARN token expired for user 582
2026-10-23T14:22:23Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:22:30Z ERR context deadline exceeded calling worker.internal
2026-10-23T14:22:37Z ERR upstream timed out after 30s while reading response from api
2026-10-23T14:23:44Z ERR no space left on device /var/lib/search
2026-10-23T14:23:51Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T14:23:58Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:23:05Z WARN 401 Unauthorized: missing bearer token
2026-10-23T14:24:12Z ERR read ECONNRESET from auth after 30000ms
2026-10-23T14:24:19Z WARN token expired for user 4453
2026-10-23T14:24:26Z WARN token expired for user 5454
2026-10-23T14:24:33Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:25:40Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:25:47Z WARN token expired for user 9176
2026-10-23T14:25:54Z ERR OAuth refresh failed for org 962: invalid_grant
2026-10-23T14:25:01Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:26:08Z ERR upstream timed out after 30s while reading response from api
2026-10-23T14:26:15Z ERR OAuth refresh failed for org 239: invalid_grant
2026-10-23T14:26:22Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T14:26:29Z ERR OAuth refresh failed for org 9105: invalid_grant
2026-10-23T14:27:36Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:27:43Z WARN token expired for user 4932
2026-10-23T14:27:50Z ERR read ECONNRESET from api after 30000ms
2026-10-23T14:27:57Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:28:04Z INFO cron job nightly-report completed
2026-10-23T14:28:11Z ERR context deadline exceeded calling billing.internal
2026-10-23T14:28:18Z ERR context deadline exceeded calling api.internal
2026-10-23T14:28:25Z ERR context deadline exceeded calling search.internal
2026-10-23T14:29:32Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T14:29:39Z WARN token expired for user 3124
2026-10-23T14:29:46Z ERR upstream timed out after 30s while reading response from auth
2026-10-23T14:29:53Z INFO deploy finished for auth v2.8488
2026-10-23T14:30:00Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:30:07Z INFO cron job nightly-report completed
2026-10-23T14:30:14Z ERR failed to write segment: ENOSPC
2026-10-23T14:30:21Z WARN feature flag new_checkout missing, using default
2026-10-23T14:31:28Z WARN disk usage 94% on volume data-5780
2026-10-23T14:31:35Z INFO deploy finished for auth v2.2356
2026-10-23T14:31:42Z WARN token expired for user 3564
2026-10-23T14:31:49Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:32:56Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T14:32:03Z ERR upstream timed out after 30s while reading response from billing
2026-10-23T14:32:10Z ERR upstream timed out after 30s while reading response from billing
2026-10-23T14:32:17Z WARN token expired for user 2246
2026-10-23T14:33:24Z ERR OAuth refresh failed for org 6880: invalid_grant
2026-10-23T14:33:31Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:33:38Z WARN token expired for user 317
2026-10-23T14:33:45Z ERR upstream timed out after 30s while reading response from worker
2026-10-23T14:34:52Z ERR context deadline exceeded calling worker.internal
2026-10-23T14:34:59Z WARN 401 Unauthorized: missing bearer token
2026-10-23T14:34:06Z WARN inode usage 97% on /tmp
2026-10-23T14:34:13Z ERR context deadline exceeded calling search.internal
2026-10-23T14:35:20Z ERR no space left on device /var/lib/api
2026-10-23T14:35:27Z INFO deploy finished for api v2.2175
2026-10-23T14:35:34Z WARN feature flag new_checkout missing, using default
2026-10-23T14:35:41Z WARN disk usage 94% on volume data-8376
2026-10-23T14:36:48Z ERR too many connections (max 100) on primary db
2026-10-23T14:36:55Z ERR OAuth refresh failed for org 2153: invalid_grant
2026-10-23T14:36:02Z ERR failed to write segment: ENOSPC
2026-10-23T14:36:09Z ERR too many connections (max 100) on primary db
2026-10-23T14:37:16Z WARN feature flag new_checkout missing, using default
2026-10-23T14:37:23Z ERR upstream timed out after 30s while reading response from api
2026-10-23T14:37:30Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T14:37:37Z WARN 401 Unauthorized: missing bearer token
2026-10-23T14:38:44Z ERR read ECONNRESET from billing after 30000ms
2026-10-23T14:38:51Z ERR OAuth refresh failed for org 6790: invalid_grant
2026-10-23T14:38:58Z ERR deadlock detected on table invoices
2026-10-23T14:38:05Z WARN 401 Unauthorized: missing bearer token
2026-10-23T14:39:12Z INFO cron job nightly-report completed
2026-10-23T14:39:19Z ERR too many connections (max 100) on primary db
2026-10-23T14:39:26Z ERR invalid signature on webhook from billing
2026-10-23T14:39:33Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:40:40Z ERR read ECONNRESET from api after 30000ms
2026-10-23T14:40:47Z WARN feature flag new_checkout missing, using default
2026-10-23T14:40:54Z WARN inode usage 97% on /tmp
2026-10-23T14:40:01Z ERR OAuth refresh failed for org 375: invalid_grant
2026-10-23T14:41:08Z INFO cache warmed in 840ms
2026-10-23T14:41:15Z ERR invalid signature on webhook from billing
2026-10-23T14:41:22Z ERR upstream timed out after 30s while reading response from billing
2026-10-23T14:41:29Z ERR invalid signature on webhook from auth
2026-10-23T14:42:36Z ERR invalid signature on webhook from worker
2026-10-23T14:42:43Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:42:50Z ERR failed to write segment: ENOSPC
2026-10-23T14:42:57Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:43:04Z ERR deadlock detected on table invoices
2026-10-23T14:43:11Z WARN token expired for user 3759
2026-10-23T14:43:18Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:43:25Z ERR read ECONNRESET from api after 30000ms
2026-10-23T14:44:32Z ERR too many connections (max 100) on primary db
2026-10-23T14:44:39Z ERR upstream timed out after 30s while reading response from auth
2026-10-23T14:44:46Z ERR too many connections (max 100) on primary db
2026-10-23T14:44:53Z INFO cache warmed in 840ms
2026-10-23T14:45:00Z ERR OAuth refresh failed for org 7125: invalid_grant
2026-10-23T14:45:07Z ERR upstream timed out after 30s while reading response from gateway
2026-10-23T14:45:14Z ERR failed to write segment: ENOSPC
2026-10-23T14:45:21Z ERR deadlock detected on table invoices
2026-10-23T14:46:28Z ERR deadlock detected on table invoices
2026-10-23T14:46:35Z WARN feature flag new_checkout missing, using default
2026-10-23T14:46:42Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T14:46:49Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:47:56Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T14:47:03Z ERR failed to write segment: ENOSPC
2026-10-23T14:47:10Z ERR read ECONNRESET from api after 30000ms
2026-10-23T14:47:17Z ERR invalid signature on webhook from gateway
2026-10-23T14:48:24Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:48:31Z ERR upstream timed out after 30s while reading response from gateway
2026-10-23T14:48:38Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:48:45Z WARN token expired for user 4998
2026-10-23T14:49:52Z ERR deadlock detected on table invoices
2026-10-23T14:49:59Z ERR too many connections (max 100) on primary db
2026-10-23T14:49:06Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:49:13Z ERR read ECONNRESET from worker after 30000ms
2026-10-23T14:50:20Z INFO cron job nightly-report completed
2026-10-23T14:50:27Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:50:34Z WARN token expired for user 7396
2026-10-23T14:50:41Z ERR context deadline exceeded calling billing.internal
2026-10-23T14:51:48Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T14:51:55Z WARN disk usage 94% on volume data-7235
2026-10-23T14:51:02Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T14:51:09Z INFO cron job nightly-report completed
2026-10-23T14:52:16Z ERR OAuth refresh failed for org 7991: invalid_grant
2026-10-23T14:52:23Z ERR context deadline exceeded calling auth.internal
2026-10-23T14:52:30Z ERR failed to write segment: ENOSPC
2026-10-23T14:52:37Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T14:53:44Z WARN 401 Unauthorized: missing bearer token
2026-10-23T14:53:51Z ERR read ECONNRESET from auth after 30000ms
2026-10-23T14:53:58Z ERR context deadline exceeded calling worker.internal
2026-10-23T14:53:05Z ERR upstream timed out after 30s while reading response from api
2026-10-23T14:54:12Z WARN token expired for user 5094
2026-10-23T14:54:19Z WARN 401 Unauthorized: missing bearer token
2026-10-23T14:54:26Z ERR upstream timed out after 30s while reading response from api
2026-10-23T14:54:33Z ERR failed to write segment: ENOSPC
2026-10-23T14:55:40Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T14:55:47Z INFO deploy finished for search v2.5710
2026-10-23T14:55:54Z ERR invalid signature on webhook from search
2026-10-23T14:55:01Z ERR deadlock detected on table invoices
2026-10-23T14:56:08Z ERR read ECONNRESET from gateway after 30000ms
2026-10-23T14:56:15Z ERR OAuth refresh failed for org 8987: invalid_grant
2026-10-23T14:56:22Z INFO cache warmed in 840ms
2026-10-23T14:56:29Z ERR upstream timed out after 30s while reading response from auth
2026-10-23T14:57:36Z ERR upstream timed out after 30s while reading response from api
2026-10-23T14:57:43Z ERR read ECONNRESET from api after 30000ms
2026-10-23T14:57:50Z ERR upstream timed out after 30s while reading response from search
2026-10-23T14:57:57Z ERR read ECONNRESET from api after 30000ms
2026-10-23T14:58:04Z ERR upstream timed out after 30s while reading response from gateway
2026-10-23T14:58:11Z INFO cron job nightly-report completed
2026-10-23T14:58:18Z WARN 401 Unauthorized: missing bearer token
2026-10-23T14:58:25Z ERR context deadline exceeded calling gateway.internal
2026-10-23T14:59:32Z ERR read ECONNRESET from gateway after 30000ms
2026-10-23T14:59:39Z INFO cache warmed in 840ms
2026-10-23T14:59:46Z ERR invalid signature on webhook from search
2026-10-23T14:59:53Z ERR deadlock detected on table invoices
2026-10-23T15:00:00Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T15:00:07Z WARN disk usage 94% on volume data-1899
2026-10-23T15:00:14Z WARN token expired for user 5299
2026-10-23T15:00:21Z ERR no space left on device /var/lib/gateway
2026-10-23T15:01:28Z ERR failed to write segment: ENOSPC
2026-10-23T15:01:35Z ERR OAuth refresh failed for org 2837: invalid_grant
2026-10-23T15:01:42Z ERR no space left on device /var/lib/search
2026-10-23T15:01:49Z WARN 401 Unauthorized: missing bearer token
2026-10-23T15:02:56Z WARN feature flag new_checkout missing, using default
2026-10-23T15:02:03Z ERR context deadline exceeded calling worker.internal
2026-10-23T15:02:10Z ERR read ECONNRESET from api after 30000ms
2026-10-23T15:02:17Z ERR deadlock detected on table invoices
2026-10-23T15:03:24Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T15:03:31Z WARN feature flag new_checkout missing, using default
2026-10-23T15:03:38Z WARN token expired for user 3808
2026-10-23T15:03:45Z ERR too many connections (max 100) on primary db
2026-10-23T15:04:52Z INFO cache warmed in 840ms
2026-10-23T15:04:59Z ERR invalid signature on webhook from gateway
2026-10-23T15:04:06Z ERR too many connections (max 100) on primary db
2026-10-23T15:04:13Z INFO cron job nightly-report completed
2026-10-23T15:05:20Z ERR context deadline exceeded calling search.internal
2026-10-23T15:05:27Z WARN feature flag new_checkout missing, using default
2026-10-23T15:05:34Z ERR upstream timed out after 30s while reading response from search
2026-10-23T15:05:41Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T15:06:48Z ERR too many connections (max 100) on primary db
2026-10-23T15:06:55Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T15:06:02Z ERR OAuth refresh failed for org 4240: invalid_grant
2026-10-23T15:06:09Z ERR upstream timed out after 30s while reading response from gateway
2026-10-23T15:07:16Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T15:07:23Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T15:07:30Z ERR deadlock detected on table invoices
2026-10-23T15:07:37Z ERR context deadline exceeded calling auth.internal
2026-10-23T15:08:44Z WARN 401 Unauthorized: missing bearer token
2026-10-23T15:08:51Z INFO cache warmed in 840ms
2026-10-23T15:08:58Z ERR OAuth refresh failed for org 7548: invalid_grant
2026-10-23T15:08:05Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T15:09:12Z ERR failed to write segment: ENOSPC
2026-10-23T15:09:19Z ERR context deadline exceeded calling auth.internal
2026-10-23T15:09:26Z ERR read ECONNRESET from worker after 30000ms
2026-10-23T15:09:33Z INFO deploy finished for gateway v2.8341
2026-10-23T15:10:40Z WARN inode usage 97% on /tmp
2026-10-23T15:10:47Z WARN token expired for user 2595
2026-10-23T15:10:54Z ERR OAuth refresh failed for org 4894: invalid_grant
2026-10-23T15:10:01Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T15:11:08Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T15:11:15Z INFO deploy finished for api v2.8263
2026-10-23T15:11:22Z ERR deadlock detected on table invoices
2026-10-23T15:11:29Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T15:12:36Z WARN token expired for user 5671
2026-10-23T15:12:43Z WARN inode usage 97% on /tmp
2026-10-23T15:12:50Z WARN disk usage 94% on volume data-7696
2026-10-23T15:12:57Z WARN inode usage 97% on /tmp
2026-10-23T15:13:04Z INFO deploy finished for auth v2.7235
2026-10-23T15:13:11Z ERR deadlock detected on table invoices
2026-10-23T15:13:18Z ERR too many connections (max 100) on primary db
2026-10-23T15:13:25Z WARN token expired for user 7543
2026-10-23T15:14:32Z ERR too many connections (max 100) on primary db
2026-10-23T15:14:39Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T15:14:46Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T15:14:53Z WARN token expired for user 9842
2026-10-23T15:15:00Z WARN token expired for user 9465
2026-10-23T15:15:07Z ERR OAuth refresh failed for org 1611: invalid_grant
2026-10-23T15:15:14Z WARN inode usage 97% on /tmp
2026-10-23T15:15:21Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T15:16:28Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T15:16:35Z ERR read ECONNRESET from auth after 30000ms
2026-10-23T15:16:42Z WARN feature flag new_checkout missing, using default
2026-10-23T15:16:49Z WARN inode usage 97% on /tmp
2026-10-23T15:17:56Z ERR read ECONNRESET from billing after 30000ms
2026-10-23T15:17:03Z INFO deploy finished for gateway v2.664
2026-10-23T15:17:10Z ERR context deadline exceeded calling gateway.internal
2026-10-23T15:17:17Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T15:18:24Z ERR deadlock detected on table invoices
2026-10-23T15:18:31Z ERR deadlock detected on table invoices
2026-10-23T15:18:38Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T15:18:45Z ERR failed to write segment: ENOSPC
2026-10-23T15:19:52Z ERR upstream timed out after 30s while reading response from worker
2026-10-23T15:19:59Z ERR too many connections (max 100) on primary db
2026-10-23T15:19:06Z ERR context deadline exceeded calling search.internal
2026-10-23T15:19:13Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T15:20:20Z ERR OAuth refresh failed for org 5689: invalid_grant
2026-10-23T15:20:27Z WARN token expired for user 4927
2026-10-23T15:20:34Z WARN token expired for user 4086
2026-10-23T15:20:41Z WARN token expired for user 8580
2026-10-23T15:21:48Z ERR read ECONNRESET from billing after 30000ms
2026-10-23T15:21:55Z ERR too many connections (max 100) on primary db
2026-10-23T15:21:02Z ERR too many connections (max 100) on primary db
2026-10-23T15:21:09Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T15:22:16Z ERR deadlock detected on table invoices
2026-10-23T15:22:23Z ERR OAuth refresh failed for org 1471: invalid_grant
2026-10-23T15:22:30Z WARN token expired for user 1689
2026-10-23T15:22:37Z ERR failed to write segment: ENOSPC
2026-10-23T15:23:44Z WARN feature flag new_checkout missing, using default
2026-10-23T15:23:51Z INFO cron job nightly-report completed
2026-10-23T15:23:58Z ERR read ECONNRESET from search after 30000ms
2026-10-23T15:23:05Z WARN request to payments-provider took 12.4s, retrying
2026-10-23T15:24:12Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T15:24:19Z ERR upstream timed out after 30s while reading response from search
2026-10-23T15:24:26Z WARN disk usage 94% on volume data-9163
2026-10-23T15:24:33Z ERR too many connections (max 100) on primary db
2026-10-23T15:25:40Z ERR upstream timed out after 30s while reading response from api
2026-10-23T15:25:47Z ERR context deadline exceeded calling api.internal
2026-10-23T15:25:54Z WARN disk usage 94% on volume data-1757
2026-10-23T15:25:01Z ERR deadlock detected on table invoices
2026-10-23T15:26:08Z INFO cache warmed in 840ms
2026-10-23T15:26:15Z INFO cron job nightly-report completed
2026-10-23T15:26:22Z ERR invalid signature on webhook from search
2026-10-23T15:26:29Z ERR context deadline exceeded calling auth.internal
2026-10-23T15:27:36Z ERR deadlock detected on table invoices
2026-10-23T15:27:43Z ERR read ECONNRESET from api after 30000ms
2026-10-23T15:27:50Z WARN 401 Unauthorized: missing bearer token
2026-10-23T15:27:57Z WARN disk usage 94% on volume data-1270
2026-10-23T15:28:04Z ERR failed to write segment: ENOSPC
2026-10-23T15:28:11Z INFO cache warmed in 840ms
2026-10-23T15:28:18Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T15:28:25Z ERR read ECONNRESET from auth after 30000ms
2026-10-23T15:29:32Z ERR invalid signature on webhook from api
2026-10-23T15:29:39Z WARN feature flag new_checkout missing, using default
2026-10-23T15:29:46Z ERR upstream timed out after 30s while reading response from search
2026-10-23T15:29:53Z ERR upstream timed out after 30s while reading response from api
2026-10-23T15:30:00Z ERR too many connections (max 100) on primary db
2026-10-23T15:30:07Z ERR no space left on device /var/lib/billing
2026-10-23T15:30:14Z ERR too many connections (max 100) on primary db
2026-10-23T15:30:21Z ERR context deadline exceeded calling search.internal
2026-10-23T15:31:28Z ERR too many connections (max 100) on primary db
2026-10-23T15:31:35Z INFO deploy finished for api v2.8559
2026-10-23T15:31:42Z ERR too many connections (max 100) on primary db
2026-10-23T15:31:49Z ERR read ECONNRESET from auth after 30000ms
2026-10-23T15:32:56Z WARN token expired for user 1992
2026-10-23T15:32:03Z ERR read ECONNRESET from api after 30000ms
2026-10-23T15:32:10Z ERR invalid signature on webhook from search
2026-10-23T15:32:17Z ERR OAuth refresh failed for org 5819: invalid_grant
2026-10-23T15:33:24Z ERR no space left on device /var/lib/api
2026-10-23T15:33:31Z ERR context deadline exceeded calling api.internal
2026-10-23T15:33:38Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T15:33:45Z ERR read ECONNRESET from billing after 30000ms
2026-10-23T15:34:52Z WARN slow query 4,812ms: SELECT * FROM events WHERE org_id = $1
2026-10-23T15:34:59Z WARN 401 Unauthorized: missing bearer token
2026-10-23T15:34:06Z ERR read ECONNRESET from billing after 30000ms
2026-10-23T15:34:13Z ERR context deadline exceeded calling api.internal
2026-10-23T15:35:20Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T15:35:27Z ERR context deadline exceeded calling billing.internal
2026-10-23T15:35:34Z ERR failed to write segment: ENOSPC
2026-10-23T15:35:41Z INFO deploy finished for billing v2.1548
2026-10-23T15:36:48Z INFO cache warmed in 840ms
2026-10-23T15:36:55Z ERR context deadline exceeded calling auth.internal
2026-10-23T15:36:02Z ERR context deadline exceeded calling auth.internal
2026-10-23T15:36:09Z ERR context deadline exceeded calling gateway.internal
2026-10-23T15:37:16Z ERR upstream timed out after 30s while reading response from auth
2026-10-23T15:37:23Z ERR read ECONNRESET from search after 30000ms
2026-10-23T15:37:30Z ERR duplicate key value violates unique constraint users_email_key
2026-10-23T15:37:37Z WARN inode usage 97% on /tmp
2026-10-23T15:38:44Z ERR too many connections (max 100) on primary db
2026-10-23T15:38:51Z ERR context deadline exceeded calling search.internal
2026-10-23T15:38:58Z ERR deadlock detected on table invoices
2026-10-23T15:38:05Z ERR OAuth refresh failed for org 6517: invalid_grant
2026-10-23T15:39:12Z ERR invalid signature on webhook from gateway
2026-10-23T15:39:19Z WARN 401 Unauthorized: missing bearer token
2026-10-23T15:39:26Z INFO cache warmed in 840ms
2026-10-23T15:39:33Z WARN 401 Unauthorized: missing bearer token`,labels:["timeout","auth","database","disk","none of these"],rec:{when:"Oct 24",ms:2221,results:[["timeout",1],["auth",1],["auth",.78],["database",1],["auth",1],["none of these",.51],["disk",1],["none of these",.77],["none of these",1],["disk",1],["auth",1],["auth",1],["auth",1],["none of these",.8],["auth",1],["timeout",1],["auth",1],["database",1],["auth",.55],["timeout",1],["timeout",.94],["auth",1],["none of these",.86],["none of these",.74],["disk",.99],["auth",1],["disk",1],["none of these",1],["timeout",1],["database",1],["timeout",1],["timeout",.86],["auth",1],["auth",.46],["timeout",1],["disk",1],["auth",1],["database",1],["auth",1],["disk",1],["none of these",1],["disk",1],["timeout",1],["none of these",.74],["disk",1],["database",1],["disk",1],["none of these",.99],["none of these",.56],["timeout",1],["none of these",.9],["disk",1],["disk",.97],["disk",1],["database",1],["auth",1],["none of these",1],["auth",1],["none of these",.99],["disk",1],["auth",1],["timeout",.7],["none of these",.99],["timeout",1],["none of these",1],["none of these",.47],["auth",1],["timeout",.92],["timeout",.89],["auth",.99],["disk",.95],["timeout",.89],["auth",1],["database",.96],["database",1],["none of these",.64],["timeout",.92],["none of these",1],["auth",1],["none of these",.52],["timeout",1],["database",.99],["database",.99],["disk",.99],["database",1],["database",.97],["disk",.94],["none of these",.8],["auth",1],["none of these",.85],["timeout",.85],["timeout",1],["disk",1],["database",.99],["none of these",.84],["auth",1],["auth",.52],["auth",1],["auth",1],["database",1],["database",.99],["auth",1],["auth",1],["database",.97],["timeout",1],["auth",1],["database",.99],["auth",1],["none of these",.68],["auth",.99],["none of these",.6],["database",.97],["none of these",1],["timeout",.77],["timeout",.75],["timeout",.79],["database",.99],["auth",1],["timeout",.94],["auth",.8],["database",.97],["none of these",.99],["disk",1],["none of these",.99],["disk",1],["auth",.73],["auth",1],["database",.97],["database",.99],["timeout",1],["timeout",1],["auth",1],["auth",1],["database",.97],["auth",.99],["timeout",1],["timeout",.9],["auth",.99],["disk",.99],["timeout",.87],["disk",1],["none of these",.99],["none of these",.97],["disk",1],["database",1],["auth",1],["disk",1],["database",1],["none of these",.97],["timeout",1],["database",1],["auth",1],["none of these",.81],["auth",1],["database",1],["auth",.99],["none of these",.99],["database",1],["auth",.66],["none of these",.71],["none of these",.85],["none of these",.99],["disk",.99],["auth",1],["none of these",1],["auth",.59],["timeout",1],["auth",.68],["auth",.66],["none of these",.61],["disk",1],["none of these",.84],["database",1],["auth",1],["none of these",.81],["none of these",.69],["database",1],["timeout",.92],["database",1],["none of these",.97],["auth",1],["timeout",1],["disk",1],["database",.99],["database",1],["none of these",.99],["database",.99],["database",.97],["database",.99],["disk",1],["none of these",.71],["auth",.73],["none of these",.6],["timeout",1],["database",1],["auth",1],["database",1],["database",1],["none of these",.7],["none of these",.68],["none of these",1],["database",1],["auth",1],["timeout",.9],["none of these",.46],["disk",1],["database",.99],["none of these",.99],["auth",1],["timeout",.65],["disk",1],["database",.99],["auth",1],["auth",.55],["timeout",.86],["timeout",1],["auth",1],["auth",1],["timeout",1],["disk",1],["database",1],["none of these",.99],["auth",.59],["database",1],["none of these",.75],["auth",1],["none of these",1],["timeout",.95],["timeout",1],["none of these",.57],["timeout",1],["timeout",.76],["timeout",.99],["none of these",1],["auth",1],["timeout",.92],["none of these",.54],["none of these",1],["auth",.85],["database",1],["database",1],["disk",1],["auth",1],["disk",1],["disk",1],["auth",1],["disk",1],["auth",1],["none of these",.99],["timeout",.95],["timeout",.45],["database",1],["database",.97],["none of these",.99],["auth",1],["database",1],["none of these",1],["auth",.84],["database",1],["none of these",1],["timeout",.84],["none of these",.97],["timeout",1],["database",.97],["database",1],["database",.96],["auth",1],["timeout",1],["none of these",.46],["database",.35],["database",1],["timeout",.64],["auth",1],["none of these",.99],["auth",1],["database",1],["disk",1],["timeout",.79],["timeout",.4],["none of these",1],["disk",.99],["auth",1],["auth",1],["database",.97],["none of these",.56],["none of these",1],["database",1],["database",1],["auth",1],["disk",.94],["disk",1],["disk",.94],["none of these",.61],["database",1],["database",1],["auth",1],["database",1],["none of these",.68],["none of these",.86],["auth",1],["auth",.99],["auth",1],["disk",.97],["none of these",.84],["none of these",.64],["auth",.42],["none of these",.96],["disk",.97],["none of these",.71],["none of these",1],["timeout",.82],["database",.97],["database",1],["database",1],["none of these",.69],["disk",1],["timeout",1],["database",.99],["timeout",.82],["database",1],["auth",1],["auth",1],["auth",1],["auth",.99],["none of these",.52],["database",1],["database",1],["none of these",.66],["database",1],["auth",1],["auth",1],["disk",1],["none of these",.97],["none of these",1],["none of these",.56],["none of these",.79],["database",.99],["timeout",1],["disk",1],["database",1],["timeout",1],["timeout",.51],["disk",1],["database",1],["none of these",1],["none of these",1],["auth",.7],["timeout",.71],["database",1],["none of these",.59],["auth",1],["disk",1],["disk",1],["none of these",1],["database",1],["auth",.7],["auth",.74],["none of these",.99],["timeout",1],["timeout",1],["database",1],["disk",1],["database",1],["timeout",.91],["database",1],["none of these",.99],["database",1],["auth",.76],["auth",1],["none of these",.49],["auth",.4],["auth",1],["disk",1],["timeout",.89],["database",.96],["none of these",.56],["database",.96],["auth",1],["none of these",.71],["timeout",.91],["database",1],["timeout",.91],["disk",1],["none of these",.97],["none of these",1],["timeout",.65],["timeout",.42],["timeout",.66],["timeout",.94],["none of these",.5],["database",1],["disk",1],["database",1],["timeout",.89],["database",1],["auth",1],["auth",.79],["auth",1],["none of these",1],["auth",1]]}};

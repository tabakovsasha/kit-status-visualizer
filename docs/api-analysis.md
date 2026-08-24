# API Analysis: Voximplant Kit (based on local examples)

## Scope and source of truth

Analysis is based only on files in `api_examples`:
- `getaccountinfo.sh`
- `getaccountinfo_200_responce.json`
- `searchUsers.sh`
- `searchUsers_200_resonce.json`
- `searchGroups.sh`
- `searchGroups_200_resonce.json`
- `searchQueues.sh`
- `searchQueues_200_resonce.json`
- `searchStatuses.sh`
- `searchStatuses_200_resonce.json`
- `searchTypeStatuses.sh`
- `searchAgentsStatuses_200_responce.json` (used as response sample for searchTypeStatuses)

No undocumented fields were added in this analysis.

## Method mapping

### 1) Get account info
- Endpoint: `GET https://{host}/api/v3/account/getAccountInfo?domain={domain}`
- Body (x-www-form-urlencoded): `access_token`
- Success envelope:
  - `success: boolean`
  - `result.domain` object with account data

Observed fields used by app:
- `result.domain.id`
- `result.domain.name`
- `result.domain.partner.media_servers_regions` (array)
- `result.domain.account_region`
- `result.domain.cc_enabled`

### 2) Search users
- Endpoint: `GET https://{host}/api/v3/user/searchUsers?domain={domain}`
- Body: `access_token`, optional `per-page`
- Success envelope:
  - `success`
  - `result: User[]`
  - `_meta: { totalCount, pageCount, currentPage, perPage }`

Important user fields:
- `id`, `username`, `email`, `group_id`, `role_id`
- `full_name`
- `call_status`, `call_status_change_time`
- `im_status`, `im_status_change_time`
- `vox_id`
- `profile.utc` (timezone source)

Observed timezone format in sample:
- `profile.utc` contains IANA name, example: `Asia/Qyzylorda`

### 3) Search groups
- Endpoint: `GET https://{host}/api/v3/usergroup/searchGroups?domain={domain}`
- Body: `access_token`
- Success envelope:
  - `success`
  - `result: Group[]`
  - `_meta`

Important group fields:
- `id`
- `group_title`
- `create_date`, `edit_date`, `deleted`

### 4) Search queues
- Endpoint: `GET https://{host}/api/v3/queues/searchQueues?domain={domain}`
- Body: `access_token`, `with_users=true`
- Success envelope:
  - `success`
  - `result: Queue[]`
  - `_meta`

Important queue fields:
- `id`
- `acd_queue_id`
- `acd_queue_name`
- `acd_queue_title`
- `users[]` with nested user snapshot fields (`id`, `full_name`, `call_status`, etc.)

### 5) Search statuses history
- Endpoint in sample:
  - `https://{host}/api/v3/history/searchStatuses?domain={host}&per-page=50`
- Body in sample:
  - `access_token`
  - `from` (`YYYY-MM-DD HH:mm:ss`)
  - `to` (`YYYY-MM-DD HH:mm:ss`)
  - `page`
  - `user_ids` (string value like `[1219]`)
  - `per-page`

Important note about discrepancy:
- In `searchStatuses.sh`, query has `domain={host}`. This conflicts with other samples that use `domain={domain}` and is treated as likely sample typo. Implementation will use `domain` account name consistently.

Success envelope:
- `success`
- `result: StatusEvent[]`
- `_meta`

Observed status event fields:
- `id`
- `user_id`
- `status`
- `status_start_date`
- `status_end_date`
- `next_status`
- `changed_by`
- `duration`

Semantics from sample:
- Entries look like status intervals (`status_start_date`..`status_end_date`) with transition hint via `next_status`.
- There are zero-duration rows where `start == end` and `duration == 0`.
- Sample page appears sorted by `status_start_date` descending.

### 6) Search status types
- Endpoint from sample script:
  - `GET https://{host}/api/v3/agentStatuses/searchStatuses?domain={domain}`
- Body: `access_token`
- Response sample file: `searchAgentsStatuses_200_responce.json`

Observed status-type fields:
- `id`
- `key`
- `title`
- `color` (hex without `#`, e.g. `7ACC90`)
- `description`
- `active`
- `system`
- `order`

## Pagination shape

Observed `_meta` shape:
```json
{
  "totalCount": 65,
  "pageCount": 2,
  "currentPage": 2,
  "perPage": 50
}
```

Fields present in all paged responses from examples: users, groups, queues, statuses.

## Date/time formats observed

- Datetime string with seconds: `YYYY-MM-DD HH:mm:ss`
- Datetime with fractional seconds: `YYYY-MM-DD HH:mm:ss.SSSSSS` (user `date_update`)
- ISO-like without timezone suffix in nested queue users: `YYYY-MM-DDTHH:mm:ss`
- Unix timestamp seconds in some user fields (`createdon`, `lastlogin`)

No explicit timezone marker (`Z` or offset) in status timestamps.

## Error format

No non-200 error samples were provided in workspace. Therefore:
- exact upstream error schema is unknown from local evidence,
- implementation must include robust fallback parsing for both JSON and non-JSON errors,
- docs and code will explicitly mark this as assumption and handle safely.

## Direct implementation constraints derived from examples

1. Do not assume missing fields such as explicit old_status.
2. Timeline reconstruction must work with `status`, `status_start_date`, `status_end_date`, `next_status`, `duration`.
3. First-segment restoration requires lookback query; if no reliable prior status, segment must become `NO_DATA`.
4. Colors in status types must be validated because sample format is raw hex without `#`.
5. Pagination helper must rely on `_meta.pageCount/currentPage` and have loop guards.
6. API client should send form-urlencoded body and preserve exact parameter names such as `per-page`.

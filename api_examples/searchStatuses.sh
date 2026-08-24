curl --location 'https://{{host}}/api/v3/history/searchStatuses?domain={{host}}&per-page=50' \
--header 'Content-Type: application/x-www-form-urlencoded' \
--data-urlencode 'access_token={{access_token}}' \
--data-urlencode 'from=2026-07-14 00:00:01' \
--data-urlencode 'to=2026-07-14 23:59:59' \
--data-urlencode 'page=1' \
--data-urlencode 'user_ids=[{{id}}]' \
--data-urlencode 'per-page=50'





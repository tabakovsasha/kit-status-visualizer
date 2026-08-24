curl --location 'https://{{host}}/api/v3/user/searchUsers?domain={{domain}}' \
--header 'Content-Type: application/x-www-form-urlencoded' \
--data-urlencode 'access_token={{access_token}}' \
--data-urlencode 'per-page=50'
curl --location 'https://{{host}}/api/v3/queues/searchQueues?domain={{domain}}' \
--header 'Content-Type: application/x-www-form-urlencoded' \
--data-urlencode 'access_token={{access_token}}' \
--data-urlencode 'with_users=true'
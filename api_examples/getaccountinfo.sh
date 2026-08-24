curl --location 'https://{{host}}/api/v3/account/getAccountInfo?domain={{domain}}' \
--header 'Content-Type: application/x-www-form-urlencoded' \
--data-urlencode 'access_token={{access_token}}'
# Internal notes

- The application runtime no longer depends on a hardcoded private IP.
- Docker Compose keeps the safe default bind address: 127.0.0.1.
- Production deployments may override this variable with the actual VM bind address when needed.

## Default runtime values

```env
HOST_BIND_IP=127.0.0.1
HOST_HTTP_PORT=8080
```

## Notes

- The app must still be started with a valid .env file.
- The external Caddy VM is responsible for public 80/443 routing.
- The application VM should not expose public ports directly.

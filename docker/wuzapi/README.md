# WuzAPI with Docker and Cloudflare Tunnel

This directory prepares WuzAPI to run in Docker and, if you want to expose it through Cloudflare, adds an optional `cloudflared` tunnel.

## What WuzAPI needs

- A server that can run containers
- PostgreSQL
- RabbitMQ
- `WUZAPI_ADMIN_TOKEN`
- `WUZAPI_GLOBAL_ENCRYPTION_KEY`

WuzAPI does not run directly on Cloudflare Workers or Pages. The correct approach is to run it on a Docker host and expose it to the internet through Cloudflare Tunnel.

## Run locally

1. Copy the example env file:

```bash
cp .env.example .env
```

2. Fill in the secrets in `.env`.
3. Start the stack:

```bash
docker compose up -d
```

WuzAPI will be available at `http://localhost:8080`.

## Expose through Cloudflare

1. Open your Cloudflare dashboard.
2. Go to `Zero Trust` > `Networks` > `Tunnels`.
3. Create a new tunnel.
4. Copy the tunnel token.
5. In `.env`, set:

```bash
CLOUDFLARE_TUNNEL_TOKEN=your-token-here
```

6. In the Cloudflare dashboard, assign a public hostname to the tunnel and point it to:

```text
http://wuzapi:8080
```

7. Start everything with the tunnel profile:

```bash
docker compose --profile cloudflare up -d
```

## Create the API user

After WuzAPI is up:

1. Use the admin token to create a user with `POST /admin/users`.
2. Save the returned `token` for normal API calls.
3. The text send route used in this project is `POST /chat/send/text`.

Note: the official WuzAPI docs show header variations between `Authorization` and `Token` in different examples. This project defaults to `Authorization` and keeps the header configurable so you can match the instance you are running.

## Files in this directory

- `docker-compose.yml`
- `.env.example`

# LiveKit (Quid Voice media server)

Quid Voice sends call audio through a self-hosted [LiveKit](https://livekit.io) SFU, behind the `MediaProvider` interface (`apps/api/src/adapters/media.ts`). Quid's API stays in charge of who may join. LiveKit only accepts short-lived tokens that the API issues.

## Local development

```bash
docker compose -f infra/docker-compose.yml --profile media up -d livekit
# or: podman run -d --name quid-livekit -p 7880:7880 -p 7881:7881 -p 7882:7882/udp docker.io/livekit/livekit-server --dev --bind 0.0.0.0
```

`.env.example` already points the API at it (`ws://localhost:7880`, key `devkey`, secret `secret`).

## Production

`./deploy.sh` (see docs/DEPLOYMENT.md) creates:

- a static IP and a firewall rule for TCP 80/443 (Caddy, Let's Encrypt), TCP 7881 (media over TCP fallback) and UDP 50000–60000 (media);
- a Container-Optimized OS VM running `livekit-server` (bound to localhost) and Caddy, which terminates TLS for `livekit.<ip-with-dashes>.sslip.io`;
- API key and secret in Secret Manager, read by the VM at boot through its own service account.

Not included yet: a TURN server for networks that block UDP and port 7881, LiveKit webhooks, and Egress for recordings (Meet).

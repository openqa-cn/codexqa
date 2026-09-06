# Security

- Do not commit tokens, cookies, or `config.yaml` files that contain secrets.
- Use environment variables (`DETECTION_TOKEN`, `DETECTION_API_KEY`, `GITHUB_TOKEN`) for credentials.
- Local mode writes task data under `data/`. Treat that directory as workspace-private.
- Remote providers should be reached over TLS. The skill sends the configured auth header on every call.
- Report vulnerabilities privately to the repository maintainers; do not file public issues with exploit details.

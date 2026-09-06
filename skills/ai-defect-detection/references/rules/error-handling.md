# Error handling strategy

| Error type | Handling |
|---|---|
| Network timeout / 5xx | Auto-retry 3 times with exponential backoff (1.5s → 2.25s → 3.375s) |
| Token expired (including APIs that return a login-page HTML) | Refresh the token via the auth provider and retry; if refresh fails, prompt to set `DETECTION_TOKEN` / `--token`. Do not ask the user to paste session credentials from another system |
| Format validation failure | The writeback API already has built-in auto pre-fix; **no manual handling needed**. Submit as-is; what can be auto-fixed will be auto-fixed |
| Quality validation failure (thinking too short / empty conclusion) | Pre-fix cannot repair this. Re-run a real analysis and retry. **Do not tweak format as a trial-and-error retry** |
| git clone failure | Stop detection for that service and note it in the final summary |
| User decision required | Ask the user and wait for a reply |

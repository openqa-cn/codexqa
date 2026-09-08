# Distribution tools

All executors POST JSON to `DATA_BUILD_API_BASE` (default `http://127.0.0.1:8765`).

| Tool | Method / path | Required params | Output |
|---|---|---|---|
| create distributor | POST `/v1/distributors` | `name` | `distributorId` |
| bind inventory | POST `/v1/distributors/{id}/inventory` | `distributorId`, `productId` | `bindingId` |
| set commission | POST `/v1/distributors/{id}/commission` | `distributorId`, `rate` | `rate` |
| browse and quote | POST `/v1/distributors/{id}/quote` | `distributorId`, `productId` | `available`, `price` |

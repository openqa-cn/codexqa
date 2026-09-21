# Catalog tools

All executors POST JSON to `DATA_BUILD_API_BASE` (default `http://127.0.0.1:8765`).

| Tool | Method / path | Required params | Output |
|---|---|---|---|
| create catalog product | POST `/v1/products` | `name` | `productId`, `name`, `kind` |
| create limited product | POST `/v1/products` | `name` (`validHours` default 4) | `productId`, `kind=limited` |
| create order | POST `/v1/orders` | `productId`, `userId` | `orderId`, `status` |
| setup account credit | POST `/v1/credits/enroll` | `productId`, `userId` | `enrolled`, `creditBalance` |

OpenAPI: [../assets/openapi/catalog.yaml](../assets/openapi/catalog.yaml).

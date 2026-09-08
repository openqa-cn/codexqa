# Backend Security Rules

> Server-specific injection and untrusted input. Items already covered by the frontend handbook or G cards are **not repeated as new gates**: XSS (G4), hardcoded secrets (G5), CORS `*`, secrets in cookies, long-lived tokens in GET query (S8), PII masking, upload type limits.
> Hits on S9–S12 start as P0 candidates, then verify in step 4.

## 📋 Quick-reference index (scan this table first; read details as needed)

| Section | Rule | Level | Quick recognition signals |
|------|------|------|------------|
| §1 | SQL injection | P0 | Concatenated SQL; MyBatis `${}` (see the data-access handbook) |
| §2 | Command injection | P0 | `Runtime.exec` / `ProcessBuilder` taking user input |
| §3 | Untrusted deserialization | P0 | `ObjectInputStream`; JSON dynamic typing enabled |
| §4 | XXE | P0 | XML parser with external entities left on |
| §5 | SSRF | P0 | User-controlled URL passed straight to `openConnection` |
| §6 | Expression injection | P0 | SpEL / OGNL / template engine evaluating a user string |
| §7 | Path traversal | P0 | File API taking `../` |
| §8 | Open redirect | P1 | 30x `Location` from an unchecked input |
| §9 | API authentication / authorization | P1 | New HTTP/RPC entry with no authn/authz |
| §10 | Error-information leak | P1 | Stack or internal SQL returned to the caller |
| §11 | Redirects / templates must not concatenate user input | P1 | `"https://"+userHost`; user text interpolated into a template string |
| §12 | Session cookie flags HttpOnly + Secure + SameSite | P1 | Server `Set-Cookie` for a session cookie with no flags |
| §13 | CSRF on cookie-session mutating HTTP | P1 | Cookie-session POST/PUT/DELETE with no CSRF check |
| §14 | No DES / MD5 / SHA-1 for security; SecureRandom for tokens | P0 / P1 | Password stored with MD5; hardcoded HMAC key; `new Random()` for tokens |
| §15 | Horizontal + vertical authorization | P0 | Query/update by resource id with no owner/tenant predicate |

---

## 1. SQL injection

Same as `backend-data-access-rules.md` §1: bind parameters; identifiers go through an allowlist.

---

## 2. Command injection

Do not build a shell command from user input. Prefer a language API over `Runtime.exec`. When a process is required, pass an argument list; do not concatenate `sh -c`.

```java
// ❌
Runtime.getRuntime().exec("gzip " + userFile);

// ✅ fixed executable + argument array, and allowlist the path
new ProcessBuilder("gzip", resolvedPath.toString()).start();
```

---

## 3. Untrusted deserialization

Do not run `ObjectInputStream` on a user byte stream. Disable automatic typing / default typing in JSON libraries. Deserialize only expected types.

```java
// ❌
objectMapper.enableDefaultTyping();
JSON.parse(userBody); // when dynamic typing is on

// ✅
objectMapper.readValue(userBody, OrderRequest.class);
```

---

## 4. XXE

When parsing XML, disable DTD / external entities.

---

## 5. SSRF

If the request URL comes from outside: validate the scheme (https only), host allowlist, and block link-local and cloud-metadata addresses.

---

## 6. Expression injection

Do not evaluate user strings in SpEL, OGNL, or server-side templates. When an expression is required, use a least-privilege evaluation context and allow literals only.

---

## 7. Path traversal

Reject `..` in filename / relative-path parameters. After normalization, the path must fall inside the agreed directory.

---

## 8. Open redirect

A server 30x target must be a relative path or a host allowlist. Do not put a full user URL straight into `Location`.

---

## 9. API authentication / authorization

New HTTP / RPC / message-consume entries must authenticate; writes also need authorization. Do not treat “intranet” as the security boundary. Resource APIs should consider abuse protection.

---

## 10. Error-information leak

Responses to a browser or public client must not include stacks, SQL, internal hosts, or secrets. Logs may keep forensics; the response body keeps only a stable error code and safe copy.

---

## 11. Redirects / templates must not concatenate user input

Open redirect: see §8. This section adds “not a 30x, but user text is still concatenated into a URL or a server-side template”: SMS/email/page jump links, callback URLs, template-engine strings. Use an allowed host + encoded path parameters, or automatic template escaping. Do not `"https://" + userInput`, and do not treat a user string as template body.

```java
// ❌
String link = "https://" + req.getHost() + "/orders/" + req.getOrderId();
templateEngine.render(req.getBody());

// ✅
String link = allowedLink("orders", req.getOrderId()); // host from config
templateEngine.render("order-notice", Map.of("orderId", req.getOrderId()));
```

---

## 12. Session cookie flags HttpOnly + Secure + SameSite

Browser-side cookie rules (do not put passwords/keys in cookies; prefer HttpOnly session ids issued by the server) are in `frontend-security-rules.md` §2.2 / §5.3. This rule does not duplicate that card. This rule only adds: when the **server** issues a session cookie via `Set-Cookie`, set **HttpOnly + Secure + SameSite** (Strict or Lax per the project). Token-in-query still goes through the frontend handbook §5.4.

```java
package com.example.order;

// ❌ session cookie with no flags
response.addHeader("Set-Cookie", "sessionId=" + sessionId);

// ✅
cookie.setHttpOnly(true);
cookie.setSecure(true);
cookie.setSameSite("Lax");
response.addCookie(cookie);
```

---

## 13. CSRF on cookie-session mutating HTTP

Frontend CSRF (attach the token on the client) is in `frontend-security-rules.md` §3. This rule does not replace that. This rule only adds the **server** check: cookie-session POST / PUT / PATCH / DELETE must validate a CSRF token (or an equivalent SameSite + custom-header defense the project already uses). Bearer-only APIs with no cookie session are out of scope. New-entry authentication still goes through §9.

```java
package com.example.order;

// ❌ cookie session; mutating handler does not check CSRF
@PostMapping("/orders")
public Result<Order> create(OrderCreateRequest request) {
    return orderService.create(request);
}

// ✅
@PostMapping("/orders")
public Result<Order> create(OrderCreateRequest request, HttpServletRequest http) {
    csrfTokens.validate(http);
    return orderService.create(request);
}
```

---

## 14. No DES / MD5 / SHA-1 for security; no hardcoded keys; use SecureRandom for tokens

Do not use DES, MD5, or SHA-1 for **security** (password/token hashing, HMAC, signatures). Non-crypto checksums are out of scope. Hardcoded keys / secrets also go through G5; this rule does not replace G5. Tokens and nonces use `SecureRandom` (P1). Reversible or weak **password storage** is P0.

```java
package com.example.order;

// ❌ weak password hash; hardcoded HMAC key; Random for a token
MessageDigest.getInstance("MD5").digest(password.getBytes());
Mac.getInstance("HmacSHA256").init(new SecretKeySpec("order-secret".getBytes(), "HmacSHA256"));
String token = Integer.toHexString(new Random().nextInt());

// ✅
passwordEncoder.encode(password); // project KDF (bcrypt / argon2 / scrypt)
Mac.getInstance("HmacSHA256").init(hmacKeyFromSecretStore());
byte[] bytes = new byte[16];
new SecureRandom().nextBytes(bytes);
```

---

## 15. Horizontal + vertical authorization

§9 is P1 “new entry must authenticate”. This rule does not replace §9 and does not lower it. This is the stronger IDOR atom (P0): an authenticated query/update must include `userId` / `tenantId` (or an equivalent resource-owner constraint) in the **server-side** predicate. Vertical checks (admin vs ordinary) must run on the server; UI-only hide/disable is insufficient.

```java
package com.example.order;

// ❌ authenticated, but any customerId is accepted
Order order = repo.findById(request.getOrderId());

// ✅ owner/tenant is part of the server predicate
Order order = repo.findByIdAndCustomerId(request.getOrderId(), currentCustomerId());
if (order == null) {
    return Result.notFound();
}
```

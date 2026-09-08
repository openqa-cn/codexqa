# Frontend Security Patterns

> Frontend CR security priorities: XSS > CSRF > sensitive-data leaks. SQL injection is a backend issue and is not part of the regular frontend check.
> Every issue includes a **runtime consequence** so severity is easier to judge.

## 📋 Rule Quick-Reference Index (scan this table first, then read details as needed)

| Section | Rule | Severity | Quick identification |
|------|------|------|------------|
| §1 | XSS | P0 | `dangerouslySetInnerHTML` / `innerHTML` / unchecked `href` |
| §2 | Sensitive data and dangerous execution | P0 | Hardcoded secrets, `eval` / `new Function`, sensitive `console` |
| §3 | CSRF | P1 | State-changing request with no CSRF Token |
| §5.1 | PII display/log masking | P1 | Phone / ID number shown or logged in plaintext |
| §5.2 | Ban CORS `*` | P1 | `Access-Control-Allow-Origin: *` |
| §5.3 | Do not put passwords/keys in cookies | P0 | `document.cookie` writes password / key |
| §5.4 | Long-lived tokens must not go in GET query | P1 | `?token=` / `?access_token=` |
| §5.5 | Uploads must restrict type | P1 | `<input type="file">` with no accept / no runtime check |

---

## 1. XSS (Cross-Site Scripting) 🔴 P0

### 1.1 Inserting user data via dangerouslySetInnerHTML

```jsx
// ❌ attacker input <script>document.cookie sent to attacker server</script>
// Runtime consequence: user Cookie / Token stolen; account taken over
function Comment({ content }) {
  return <div dangerouslySetInnerHTML={{ __html: content }} />;
  //                                            ^^^^^^^ user data inserted directly!
}

// ✅ option 1: render as plain text (safest)
function Comment({ content }) {
  return <div>{content}</div>; // React escapes automatically
}

// ✅ option 2: when HTML must be rendered, sanitize with DOMPurify first
import DOMPurify from 'dompurify';
function Comment({ content }) {
  const clean = DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong'], // only safe tags
    ALLOWED_ATTR: [],
  });
  return <div dangerouslySetInnerHTML={{ __html: clean }} />;
}
```

**CR checkpoint**: Does every `dangerouslySetInnerHTML` `__html` value come from user input or API data? If so, it must go through `DOMPurify.sanitize`.

---

### 1.2 Writing innerHTML / outerHTML directly

```javascript
// ❌ equivalent to dangerouslySetInnerHTML, but easier to miss in native DOM code
// Runtime consequence: same as above; XSS runs arbitrary script
element.innerHTML = userInput;          // ❌
element.outerHTML = `<div>${data}</div>`; // ❌
document.write(userInput);              // ❌ more dangerous; writes the document stream

// ✅ use safe DOM APIs
element.textContent = userInput;   // plain text, safe
element.setAttribute('data-x', userInput); // attribute assignment, safe
element.appendChild(document.createTextNode(userInput)); // text node, safe
```

---

### 1.3 href / src attribute injection

```jsx
// ❌ javascript: pseudo-protocol executes script
// Runtime consequence: attacker code runs when the user clicks the link
function UserLink({ url }) {
  return <a href={url}>Click</a>; // url = "javascript:alert(document.cookie)"
}

// ✅ validate the URL protocol
function UserLink({ url }) {
  const isSafe = url.startsWith('http://') || url.startsWith('https://');
  if (!isSafe) return <span>Invalid link</span>;
  return <a href={url} rel="noopener noreferrer">Click</a>;
}

// ❌ img src can also be injected
<img src={userProvidedUrl} />  // onerror can trigger script

// ✅ allowlist domain check
function Avatar({ src }) {
  const ALLOWED_DOMAINS = ['cdn.example.com', 'images.example.com'];
  try {
    const { hostname } = new URL(src);
    if (!ALLOWED_DOMAINS.includes(hostname)) return <img src="/default-avatar.png" />;
  } catch {
    return <img src="/default-avatar.png" />;
  }
  return <img src={src} alt="avatar" />;
}
```

---

### 1.4 eval / new Function / setTimeout(string) executing a string

```javascript
// ❌ executing a string → arbitrary code execution
// Runtime consequence: full code-execution rights; the most severe XSS
eval(userInput);
new Function('x', userInput)();
setTimeout(userInput, 0);   // string-form setTimeout is equivalent to eval
setInterval(userInput, 100); // same

// ✅ use a concrete function instead of executing a string
setTimeout(() => doSomething(), 0);  // function form, safe
```

**CR checkpoint**: Do `eval`/`new Function`/`setTimeout(string)` exist? If they do, is there a strong reason? This is P0 among P0s.

---

## 2. Sensitive-Data Leaks 🔴 P0

### 2.1 Hardcoded secrets / tokens

```javascript
// ❌ all of the following are P0; anyone who sees the source (including the compiled bundle) can obtain them
const API_KEY, ACCESS_TOKEN, STORAGE_SECRET, DB_PASSWORD 

// ✅ option 1: fetch from a backend API; do not store on the frontend
const { apiKey } = await getSecretFromServer();

// ✅ option 2: inject env vars at build time (public, non-sensitive config only)
const BASE_URL = process.env.REACT_APP_API_URL; // public URL, allowed
// note: process.env is inlined into the bundle after build and is still public
// real secrets must never go on the frontend
```

**Runtime consequence**: Anyone can download and inspect the bundle; the secret leaks immediately; APIs are abused / data is leaked.

---

### 2.2 Storing sensitive data in localStorage

```javascript
// ❌ localStorage can be read by all same-origin JS (including XSS-injected scripts)
localStorage.setItem('token', userToken);         // ❌ identity credential
localStorage.setItem('nationalId', '000000****0000'); // ❌ government ID number
localStorage.setItem('creditCard', '4111****');  // ❌ bank card

// ✅ Token: use an HttpOnly Cookie (set by the backend; JS cannot read it)
// ✅ Sensitive state: store in sessionStorage (cleared when the tab closes) + short TTL
// ✅ When not needed: do not store PII (personally identifiable information) on the frontend
```

---

## 3. CSRF (Cross-Site Request Forgery) 🟡 P1

### 3.1 Frontend CSRF defenses

CSRF is primarily a backend defense; the frontend cooperates:

```javascript
// ✅ axios automatically attaches a CSRF Token (common setup)
import axios from 'axios';

// read the CSRF Token from a Cookie (set by the backend)
function getCsrfToken() {
  return document.cookie
    .split('; ')
    .find(row => row.startsWith('csrfToken='))
    ?.split('=')[1];
}

// send it in the request header
axios.defaults.headers.common['X-CSRF-Token'] = getCsrfToken();

// ❌ dangerous third-party POST form (can be used as a CSRF attack vector)
<form action="https://api.example.com/transfer" method="POST">
  <input type="hidden" name="amount" value="10000" />
  <input type="submit" />
</form>
// an attacker can place this form on any page and trick the user into clicking
```

**CR checkpoint**: Are there state-changing requests (POST/PUT/DELETE) without a CSRF Token? Does the form action point at your own domain?

---

## 4. Quick Security Scan Table

| Pattern | Risk | Severity |
|------|------|------|
| `dangerouslySetInnerHTML={{ __html: variable }}` | XSS | P0 |
| `element.innerHTML = variable` | XSS | P0 |
| `eval(...)` / `new Function(...)` | Arbitrary code execution | P0 |
| `href={userInput}` with no protocol check | XSS | P0 |
| Hardcoded `key`/`token`/`secret`/`password` literals | Secret leak | P0 |
| Sensitive data in `localStorage` | Data leak | P1 |
| `setTimeout(string, n)` | XSS | P0 |
| POST request without a CSRF Token | CSRF | P1 |
| Phone / ID number shown or logged in plaintext | PII leak | P1 |
| `Access-Control-Allow-Origin: *` | Overly broad CORS | P1 |
| Cookie writes password / secret | Credential leak | P0 |
| `fetch('/api?token=' + authToken)` | Token in URL | P1 |
| `<input type="file">` with no accept / type check | Dangerous file upload | P1 |

> Automated detection (`tooling/security-scan.js`, step 2.1) covers: hardcoded secrets, innerHTML, eval, `new Function`, query tokens.
> The table above helps the AI review **semantic issues the scanner misses** (for example, dynamically constructed dangerous strings).

---

## 5. Additional Security Boundaries

This section does not replace XSS / secrets / CSRF above.

### 5.1 Mask personal sensitive information

When displaying or logging, phone numbers, government ID numbers, and bank card numbers must be masked. Do not `console.log` a full ID number.

```js
// ❌
console.log('nationalId', user.nationalId);
text.textContent = user.phone;

// ✅
console.log('nationalId', maskNationalId(user.nationalId));
text.textContent = maskPhone(user.phone); // e.g. ***-***-1234
```

### 5.2 Ban unrestricted CORS

`Access-Control-Allow-Origin: *` in frontend or gateway config together with credentialed responses → P1. Origins must be an explicit allowlist.

### 5.3 Do not store passwords or crypto keys in cookies

```js
// ❌
document.cookie = `password=${pwd}`;
document.cookie = `aesKey=${key}`;
```

Session IDs are issued by the server via Set-Cookie (HttpOnly). The frontend must not write passwords/keys into cookies.

### 5.4 Long-lived auth tokens must not go in GET query

```js
// ❌
fetch(`https://api.example.com/data?access_token=${authToken}`);

// ✅
fetch('https://api.example.com/data', {
  headers: { Authorization: `Bearer ${authToken}` },
});
```

Tokens in the URL end up in access logs, Referer, and browser history. Short-lived one-time codes are out of scope.

### 5.5 Uploads must restrict type

File uploads must restrict both `accept` and runtime MIME/extension, allowing only types the product needs.

```jsx
// ❌
<input type="file" onChange={onUpload} />

// ✅
<input type="file" accept="image/jpeg,image/png" onChange={onUpload} />
```

`onUpload` must still validate `file.type` / extension; do not rely on `accept` alone.

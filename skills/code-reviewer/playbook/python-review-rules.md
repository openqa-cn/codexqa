# Python Review Rules

> Load on demand when the diff includes `.py`. Language tag on every row is `Python` so a Python-only repo can be reviewed without loading Java, TypeScript, or C/C++ handbooks.
> SQL injection, command injection, SSRF, XXE, path traversal, deserialization, hardcoded secrets, and weak hashes still start from `backend-security-rules.md` / `backend-data-access-rules.md` and pocket cards G4 / G5 / B2 / B9. This file adds only Python APIs and framework atoms those cards do not name.
> Formatting and import order belong to the formatter / linter — do not repeat them here.
> Examples use `orders`, `customer_id`, and `example.com`.

## 📋 Quick-reference index (scan this table first; read details as needed)

| Section | Rule | Level | Lang | Quick recognition signals |
|------|------|------|------|------------|
| §1 | Reject invalid input; do not coerce or default it | P1 | Python | Trim / `int()` / clamp / fake email after a failed check |
| §2 | User-controlled URL fetch must block private hops | P0 | Python | `requests.get(request.args["url"])` with no scheme/IP check |
| §3 | Disable XML external entities on Python parsers | P0 | Python | `etree.fromstring` / `XMLParser()` with entities left on |
| §4 | No unsafe YAML / pickle / marshal on untrusted data | P0 | Python | `yaml.unsafe_load`; `pickle.loads(body)` |
| §5 | Correct Content-Type; escape `text/html` bodies | P0 / P1 | Python | `return f"<p>{text}</p>"`; JSON served as `text/html` |
| §6 | Do not interpolate SQL into `cursor.execute` | P0 | Python | `%` / f-string / `+` / `join` into the SQL string |
| §7 | No `eval` / `exec` / `compile` on external text | P0 | Python | `eval(request.json)`; `exec(user_src)` |
| §8 | Process spawn: no `shell=True`; allowlist argv | P0 / P1 | Python | `os.system`; `subprocess.run(..., shell=True)` |
| §9 | Upload and read stay under a server-fixed root | P0 / P1 | Python | `open(base + name)`; suffix check only in the browser |
| §10 | Production Flask/Django debug must be off | P0 | Python | `app.debug = True`; `DEBUG = True`; empty `ALLOWED_HOSTS` |
| §11 | Do not return stacks or debug pages to clients | P1 | Python | `traceback` in a 500 body; debug toolbar in production |
| §12 | Same `if`/`elif` condition; silly equality; self-assign | P1 | Python | `elif x:` twice; `a == a`; `x = x` |
| §13 | Do not ignore a pure return or assign `None` from an in-place method | P1 | Python | `s.replace(...)` unused; `x = orders.sort()` |
| §14 | Format arity must match; `open` mode must be valid | P1 | Python | `"%s %s" % (a,)`; `open(path, "rw")` |
| §15 | Dunder methods must use the expected arity | P1 | Python | `def __eq__(self):`; extra args on `__len__` |
| §16 | `re.sub` replacement must reference existing groups | P1 | Python | `\\2` when the pattern has one group |
| §17 | Hardcoded IP literals are security-sensitive | P2 | Python | `"10.1.2.3"` / `"192.168."` in source |

---

## 1. Reject invalid input; do not coerce or default it

At an HTTP / RPC / message entry, check type, length, range, and format. If a field fails, **reject** the request. Do not `str()` / `int()` / slice / clamp / substitute a default to make it pass. This rule does **not** replace `backend-service-rules.md` §27 (validate at the entry).

```python
# ❌
age = int(data.get("age"))
if age > 120:
    age = 120
name = str(data.get("name"))[:50]

# ✅
name = data.get("name")
age = data.get("age")
if not isinstance(name, str) or len(name) > 50:
    raise ValueError("invalid name")
if not isinstance(age, int) or not (0 <= age <= 120):
    raise ValueError("invalid age")
```

---

## 2. User-controlled URL fetch must block private hops

When the caller supplies a URL to fetch, download, or load as an image: allow only `http` / `https`; resolve the host and **reject** loopback, link-local, and RFC1918 / unique-local addresses; cap redirects and **re-check** the next `Location` (DNS can change between hops). This rule does **not** replace `backend-security-rules.md` §5.

```python
# ❌
@app.route("/unsafe")
def unsafe():
    return requests.get(request.args["url"]).text

# ✅
parsed = urlparse(url)
if parsed.scheme not in ("http", "https"):
    raise ValueError("scheme")
ip = ipaddress.ip_address(socket.gethostbyname(parsed.hostname))
if ip.is_private or ip.is_loopback or ip.is_link_local:
    raise ValueError("blocked hop")
response = requests.get(url, allow_redirects=False, timeout=5)
```

---

## 3. Disable XML external entities on Python parsers

Do not parse untrusted XML with the default `lxml.etree` parser (external entities on). Use `XMLParser(resolve_entities=False)` or a defused parser. Stdlib `xml.etree` must not be given a DTD that loads files or URLs. This rule does **not** replace `backend-security-rules.md` §4.

```python
# ❌
tree = etree.fromstring(xml_data)

# ✅
parser = etree.XMLParser(resolve_entities=False)
tree = etree.fromstring(xml_data, parser=parser)
```

---

## 4. No unsafe YAML / pickle / marshal on untrusted data

Do not call `yaml.unsafe_load`, `yaml.load` without a `SafeLoader`, `pickle.loads`, or `marshal.loads` on a request body, file upload, or cache blob from another trust domain. Use `yaml.safe_load` or an explicit schema. This rule does **not** replace `backend-security-rules.md` §3 (Java deserialization).

```python
# ❌
doc = yaml.unsafe_load(body)
order = pickle.loads(body)

# ✅
doc = yaml.safe_load(body)
```

---

## 5. Correct Content-Type; escape `text/html` bodies

Set `Content-Type` to the actual body type. Do not label JSON, CSV, or XML as `text/html`. When the type **is** `text/html`, escape untrusted text (`html.escape` or the template engine’s autoescape). This complements G4 and does **not** retune it.

```python
# ❌
@app.route("/unsafe")
def unsafe():
    return f"<p>{request.args.get('text')}</p>"

# ✅
@app.route("/safe")
def safe():
    text = html.escape(request.args.get("text", ""))
    return f"<p>{text}</p>"
```

---

## 6. Do not interpolate SQL into `cursor.execute`

Bound parameters only: `cursor.execute("… WHERE customer_id = %s", (customer_id,))`. Do not build the statement with `%`, an f-string, `+`, or `"".join`. Prefer the project ORM when it already parameterizes. Identifiers (table/column) still need an allowlist. This rule does **not** replace `backend-data-access-rules.md` §1.

```python
# ❌
cur.execute("SELECT id FROM orders WHERE customer_id=%s " % (customer_id,))
cur.execute(f"SELECT id FROM orders WHERE customer_id={customer_id}")
cur.execute("SELECT id FROM orders WHERE customer_id=" + customer_id)

# ✅
cur.execute("SELECT id FROM orders WHERE customer_id=%s", (customer_id,))
```

---

## 7. No `eval` / `exec` / `compile` on external text

`eval`, `exec`, `execfile`, and `compile` on request data, query strings, or uploaded files are P0. This complements G4’s JavaScript `eval` and does **not** change the JS/TS S5 scan.

```python
# ❌
eval(request.args.get("expr"))
exec(user_src)

# ✅
# parse a declared grammar or a JSON schema; do not execute source
payload = json.loads(body)
```

---

## 8. Process spawn: no `shell=True`; allowlist argv

Prefer filesystem / library APIs (`os.remove`, `pathlib`) over `os.system` / `os.popen`. If a process is required: `subprocess.run(args, shell=False)`, allowlist `args[0]` (and arguments), and never concatenate user text into a shell string. `shlex.split` is only a parser — still allowlist after split. This rule does **not** replace B9 / `backend-security-rules.md` §2.

```python
# ❌
os.system("ls " + user_input)
subprocess.run(user_input, shell=True)

# ✅
args = shlex.split(user_input)
if args[0] != "ls":
    raise ValueError("command")
subprocess.run(args, shell=False, check=True, timeout=5)
```

---

## 9. Upload and read stay under a server-fixed root

Uploads: allowlist suffix **and** MIME **and** size on the server. A browser-only suffix check is not enough. Reads: join a **server-fixed** directory with an allowlisted file name; `os.path.normpath` of the result must still start with that directory. This rule does **not** replace `backend-security-rules.md` §7. Do not require a vendor upload product.

```python
# ❌
path = os.path.join("/var/orders/", user_name)
with open(path) as fh:
    return fh.read()

# ✅
if user_name not in ALLOWED_FILES:
    raise ValueError("name")
path = os.path.normpath(os.path.join("/var/orders/", user_name))
if not path.startswith("/var/orders/"):
    raise ValueError("path")
with open(path) as fh:
    return fh.read()
```

---

## 10. Production Flask/Django debug must be off

Production must not ship `app.debug = True` or Django `DEBUG = True` (debug pages leak stacks, settings, and locals). Django `ALLOWED_HOSTS` must be a concrete host list, not empty or `*`, when debug is off.

```python
# ❌
app.debug = True
DEBUG = True
ALLOWED_HOSTS = ["*"]

# ✅
app.debug = False
DEBUG = False
ALLOWED_HOSTS = ["example.com", "www.example.com"]
```

---

## 11. Do not return stacks or debug pages to clients

`try/except` must not send `traceback.format_exc()`, SQL, or internal hosts to the browser. Turn off the debug toolbar / `debug=True` server in production. Logs may keep forensics. This rule does **not** replace `backend-security-rules.md` §10.

```python
# ❌
except Exception as exc:
    return str(exc), 500

# ✅
except Exception:
    logger.exception("list_orders failed")
    return {"error": "unavailable"}, 500
```

---

## 12. Same `if`/`elif` condition; silly equality; self-assign

Two `if` / `elif` branches with the same condition, `customer_id == customer_id`, or `status = status` are dead or no-ops. Complements `go-review-rules.md` §16 and does **not** retune it.

```python
# ❌
if ready:
    ship(order)
elif ready:
    hold(order)
if customer_id == customer_id:
    pass
status = status

# ✅
if ready:
    ship(order)
elif blocked:
    hold(order)
```

---

## 13. Do not ignore a pure return or assign `None` from an in-place method

`str.replace` / `str.strip` / `sorted` return a new value — ignoring it is a no-op. `list.sort` / `list.reverse` return `None`; do not assign that. Complements `typescript-review-rules.md` §15 (void return) and does **not** retune it.

```python
# ❌
name.replace(" ", "")
ordered = orders.sort()

# ✅
name = name.replace(" ", "")
orders.sort()
```

---

## 14. Format arity must match; `open` mode must be valid

`%` / `str.format` argument count must match the placeholders (`%s` in SQL still goes through §6). `open` mode must be a valid Python mode (`r`, `w`, `a`, `x`, `+`, `b`, `t` combinations) — not `"rw"` or a random string. Path traversal still goes through §9.

```python
# ❌
label = "%s %s" % (order_id,)
open(path, "rw")

# ✅
label = "%s %s" % (order_id, customer_id)
open(path, "r")
```

---

## 15. Dunder methods must use the expected arity

`__eq__` / `__lt__` take `self, other`. `__len__` / `__hash__` / `__str__` take `self` only. A wrong signature is called incorrectly by the runtime.

```python
# ❌
class Order:
    def __eq__(self):
        return True
    def __len__(self, extra):
        return 0

# ✅
class Order:
    def __eq__(self, other):
        return self.customer_id == other.customer_id
    def __len__(self):
        return 1
```

---

## 16. `re.sub` replacement must reference existing groups

`re.sub` / `re.subn` replacements (`\\1`, `\\g<name>`) must only name groups that the pattern defines. Do not treat “regex is syntactically valid” as a separate CR gate.

```python
# ❌
re.sub(r"(order-\d+)", r"\2", raw)

# ✅
re.sub(r"(order-\d+)", r"id-\1", raw)
```

---

## 17. Hardcoded IP literals are security-sensitive

Literal `10.*` / `192.168.*` / `127.0.0.1` / public IPs in source couple the process to one host and leak topology. Prefer config / DNS. Complements `typescript-review-rules.md` §21 and is **not** G5 (secrets).

```python
# ❌
host = "10.1.2.3"

# ✅
host = os.environ.get("ORDER_HOST", "orders.example.com")
```


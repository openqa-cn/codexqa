# Backend Data Access (SQL / ORM)

> Load when the diff includes `.sql`, `*Mapper.xml`, `*Mapper.java`, `*Repository*`, or SQL strings.
> SQL injection and `${}` are also checked against `backend-security-rules.md` and step 2.1 S9.

## 📋 Quick-reference index (scan this table first; read details as needed)

| Section | Rule | Level | Quick recognition signals |
|------|------|------|------------|
| §1 | Parameterized queries | P0 | String-built SQL; MyBatis `${}` |
| §2 | No UPDATE/DELETE without WHERE | P0 | `UPDATE t SET` with no condition |
| §3 | No SELECT * | P1 | `SELECT *`; Mapper result as a bare HashMap |
| §4 | COUNT / INSERT column lists | P1 | `COUNT(col)` used as a total; `INSERT` with no column names |
| §5 | In-memory pagination | P0 | MyBatis `RowBounds` scanning a large table |
| §6 | Read replica immediately after write | P1 | `select` on the default replica right after update |
| §7 | Money column types | P0 | Table stores money as FLOAT/DOUBLE; entity uses `double` |
| §8 | Full table / unindexed predicates | P1 | Large table with no WHERE, or a function wrapping an indexed column |
| §9 | Unique business keys need a unique index | P1 | Idempotency key with no UNIQUE |
| §10 | Minimum table fields | P2 | Missing primary key / created-at / updated-at (new tables) |
| §11 | Batch IN must equal the selected set | P0 | Batch update missing the caller’s ID list; empty IN treated as full table |
| §12 | No stored procedures | P1 | `CREATE PROCEDURE` / `CALL` |
| §13 | Multi-table queries must qualify aliases | P2 | Bare column `id` / `status` after JOIN |
| §14 | IN sets should not be huge | P1 | A single `IN` with hundreds of literals or an unbatched large list |
| §15 | Test null with `IS NULL` | P1 | `col = NULL` / `col <> NULL` |
| §16 | `COUNT(DISTINCT a,b)` and NULL | P1 | Multi-column DISTINCT without excluding all-NULL columns |
| §17 | `SUM` of all-NULL is NULL | P1 | Bare `SUM(amount)` unboxed directly |
| §18 | No DDL on the request path | P0 | `ALTER`/`DROP`/`TRUNCATE`/`CREATE INDEX` in application code |
| §19 | Split large writes into batches | P1 | Single INSERT/UPDATE of thousands of rows |
| §20 | External queries must have LIMIT | P1 | Client-facing list SQL with no cap |
| §21 | Confirm scope before destructive DML | P2 | `DELETE`/`UPDATE` with no visible affected-row count |
| §22 | Soft-delete preferred; hard delete needs confirm + backup | P2 | Hard `DELETE` of business rows with no confirm/backup story |
| §23 | Sharded queries must carry the shard key | P1 | Sharded table query/update with no shard/tenant/customer key |
| §24 | Search engine: no deep from+size | P1 | `from+size` at large offsets; scroll not cleared |
| §25 | Search writes: bulk with a stable document id; no mapping type change | P1 / P2 | Missing `_id`; changing an existing field type |
| §26 | Wide-column / HBase-like Scan needs start+stop | P1 | Full-table `Scan(`; timestamp-only row-key prefix |

---

## 1. Parameterized queries

User input must be bound as parameters. MyBatis uses `#{}`; `${}` is forbidden (unless the identifier already passed an allowlist, e.g. a table-name whitelist). JDBC uses `PreparedStatement`. Dynamic sort columns / table names must not be concatenated.

```xml
<!-- ❌ -->
SELECT * FROM orders WHERE id = ${id}
<!-- ✅ -->
SELECT id, status FROM orders WHERE id = #{id}
```

```java
// ❌
jdbc.query("SELECT * FROM orders WHERE id = " + id);

// ✅
jdbc.query("SELECT id, status FROM orders WHERE id = ?", id);
```

---

## 2. No UPDATE/DELETE without WHERE

Updates and deletes must have a scoping WHERE (or an equivalent primary-key / batch IN whose IN comes from a trusted set). Full-table updates are allowed only in backfill jobs with an explicit ops switch and backup, and the CR must state the affected-row count.

---

## 3. No SELECT *

List the columns you need. Do not take query results straight into a `HashMap` (column types and null semantics are lost).

---

## 4. COUNT / INSERT column lists

`COUNT(*)` counts rows (including rows whose column is null). `COUNT(col)` does not count rows where that column is null. `INSERT` must name columns.

---

## 5. In-memory pagination

MyBatis `RowBounds` often fetches everything then slices in memory; large tables OOM. Use database `LIMIT`/`OFFSET` or keyset pagination. Statement timeout and connection timeout are not the same thing; configure them separately.

```java
// ❌
mapper.selectAll(new RowBounds(page * size, size));

// ✅
mapper.selectPage(status, offset, size);
```

---

## 6. Read replica immediately after write

Primary/replica lag can hide a just-written row on the replica. Write-then-read, read-modify-write, and immediately syncing downstream after write: go to the primary or wait for replication to catch up. Ordinary reads may use the replica.

---

## 7. Money column types

Money and rates use `DECIMAL` + `BigDecimal`. Do not store money as `FLOAT` / `DOUBLE`.

---

## 8. Full table / unindexed predicates

For new or rewritten SQL: can WHERE use an index; is a large column searched with `%x%` or wrapped in a function. Per-row SQL inside a loop: see design-quality N+1.

---

## 9. Unique business keys need a unique index

Idempotency keys and business order numbers must be UNIQUE in the database, not judged only in application memory.

---

## 10. Minimum table fields

New tables: primary key, created-at, updated-at. Prefer `NOT NULL` columns with defaults. Strings use the project’s unified charset (commonly `utf8mb4`). Consistency is an application-layer duty; do not treat foreign-key cascade as the business delete strategy (unless the repo already has that convention). This rule is P2/P1 for new DDL; it does not require backfilling existing tables in one shot.

---

## 11. Batch IN must equal the selected set

When the caller passes a “selected ID list”, the `UPDATE`/`DELETE` WHERE must include that list (`id IN (...)` or equivalent). An empty list must be rejected or become a no-op; an empty `IN` **must not** be optimized by the ORM into “no constraint = full table”. Before the operation, `countByIds` can cross-check against the input size. Finer than §2 “no WHERE at all”: a WHERE whose scope is larger than the user’s selection is still P0.

```java
// ❌ only changed the site; did not limit to the selected licenses
licenseMapper.updateSiteForAll(newSiteId);

// ❌ still executes when ids is empty
licenseMapper.updateSite(newSiteId, ids);

// ✅
if (ids == null || ids.isEmpty()) {
    throw new IllegalArgumentException("ids required");
}
licenseMapper.updateSiteByIds(newSiteId, ids);
```

---

## 12. No stored procedures

Application paths must not `CREATE PROCEDURE` / `CALL`. Business branches, loops, and transaction compensation belong in the service layer, for testability and cross-database portability.

```sql
-- ❌
CREATE PROCEDURE GetActiveOrders()
BEGIN
    SELECT id, status FROM orders WHERE status = 'active';
END;
CALL GetActiveOrders();

-- ✅ ordinary SQL + service code
SELECT id, status FROM orders WHERE status = 'active';
```

---

## 13. Multi-table queries must qualify aliases

With two or more tables, column names must carry a table alias (or table name) to avoid `id` / `status` ambiguity.

```sql
-- ❌
SELECT name, amount
FROM customers
JOIN orders ON id = customer_id
WHERE status = 'active';

-- ✅
SELECT c.name, o.amount
FROM customers AS c
JOIN orders AS o ON c.id = o.customer_id
WHERE c.status = 'active';
```

---

## 14. IN sets should not be huge

Prefer equality, a range, or a JOIN over a huge `IN`. A single statement’s `IN` should stay around **200** elements or fewer; larger sets batch the query, or switch to JOIN / a temp table. Complements §11: that rule covers “missing selected IDs”; this one covers “the list is too large”.

```sql
-- ❌ hundreds of ids in one IN
SELECT id, status FROM orders WHERE id IN ( /* 500 ids */ );

-- ✅ batch, or use BETWEEN for a contiguous range
SELECT id, status FROM orders WHERE id BETWEEN 1 AND 200;
```

---

## 15. Test null with IS NULL

Null checks in predicates use `IS NULL` / `IS NOT NULL`. `= NULL` / `<> NULL` is not true or false; rows are filtered out silently. Expressions that need a fallback use `COALESCE` / `IFNULL`.

```sql
-- ❌
SELECT id FROM orders WHERE customer_id = NULL;

-- ✅
SELECT id FROM orders WHERE customer_id IS NULL;
SELECT id, COALESCE(note, '') AS note FROM orders;
```

---

## 16. COUNT(DISTINCT a,b) and NULL

`COUNT(DISTINCT col)` does not count rows where that column is NULL. For `COUNT(DISTINCT col1, col2)`, **if either column is all NULL, the result is 0**, even when the other column has distinct values. Before multi-column distinct, ensure participating columns have values, or count them separately.

```sql
-- ❌ NULL not handled
SELECT COUNT(DISTINCT customer_id, sku_id) FROM order_items;

-- ✅
SELECT COUNT(DISTINCT customer_id, sku_id)
FROM order_items
WHERE customer_id IS NOT NULL AND sku_id IS NOT NULL;
```

---

## 17. SUM of all-NULL is NULL

With no rows, or when the column is all NULL, `SUM(col)` returns NULL, not 0. Unboxing in the application is an NPE. Use `COALESCE(SUM(col), 0)`.

```sql
-- ❌
SELECT SUM(amount) FROM orders WHERE customer_id = #{customerId};

-- ✅
SELECT COALESCE(SUM(amount), 0) FROM orders WHERE customer_id = #{customerId};
```

---

## 18. No DDL on the request path

Running application code (including Mapper strings and startup scripts used as request handling) must not `CREATE` / `ALTER` / `DROP` / `TRUNCATE` / `CREATE INDEX`. Schema changes go through migration scripts or the repo’s existing change process; do not alter schema on a request thread.

```java
// ❌
jdbc.execute("ALTER TABLE orders ADD COLUMN note VARCHAR(255)");
jdbc.execute("DROP TABLE tmp_orders");

// ✅ DML only
jdbc.update("UPDATE orders SET status = ? WHERE id = ?", status, id);
```

---

## 19. Split large writes into batches

Large `INSERT` / `UPDATE` / `DELETE` batches should stay at **1000** rows or fewer per batch; split beyond that, and leave a gap between batches to reduce lock time and replication lag. Also satisfy §11 (scope must equal the selected set).

---

## 20. External queries must have LIMIT

List APIs open to a browser or public client must cap SQL (when the repo has no convention, recommend no more than **100**). Prevents an unbounded result set from crushing the database or leaking a whole table. Internal admin tools may relax per project convention, but a cap is still required.

```java
// ❌
String sql = "SELECT id, name FROM customers";

// ✅
int limit = Math.min(requestedLimit, 100);
String sql = "SELECT id, name FROM customers WHERE status = ? LIMIT ? OFFSET ?";
```

---

## 21. Confirm scope before destructive DML

Given a WHERE (§2), `UPDATE` / `DELETE` should be able to show the affected-row count: an equivalent `SELECT COUNT(*)` first, a dry run, or logs of the primary keys about to be updated. This rule is P2 and **does not replace** the §2 no-WHERE ban.

---

## 22. Soft-delete preferred; hard delete needs confirm + backup

Business records prefer a `deleted` / `status` flag over a physical `DELETE`. Hard delete of business data needs an explicit confirm path and a backup/recover story. Confirm-scope (affected-row count / dry run) still goes through §21; no-WHERE still goes through §2. This rule does not replace those. P2.

```sql
-- ❌ hard-delete business rows with no confirm/backup in the change
DELETE FROM orders WHERE customer_id = #{customerId};

-- ✅ soft-delete
UPDATE orders SET deleted = 1, updated_at = NOW()
WHERE customer_id = #{customerId} AND deleted = 0;
```

---

## 23. Sharded queries must carry the shard key

Queries and updates that hit a sharded table must include the shard / tenant / customer routing key. A scatter-gather with no routing key is P1 (full-shard scan, wrong shard, or silently empty). Tenant in WHERE for multi-tenant SQL still goes through `backend-service-rules.md` §4 / §20; this rule adds the **shard routing** key when the table is sharded.

```sql
-- ❌ sharded orders, no shard/customer key
SELECT id, status FROM orders WHERE status = 'ACTIVE';

-- ✅
SELECT id, status FROM orders
WHERE customer_id = #{customerId} AND status = 'ACTIVE';
```

---

## 24. Search engine: no deep from+size

On a search engine (Elasticsearch-like), do not deep-paginate with `from+size` at large offsets. The common default `max_result_window` is about **10000**; treat crossing it (or walking large offsets toward it) as this rule, not as a company SLA. Prefer `search_after` / a cursor / scroll, and **clear scroll** when finished. SQL list caps still go through §20.

```java
package com.example.order;

// ❌ deep from+size; scroll never cleared
search.source(new SearchSourceBuilder().from(50000).size(20));

// ✅ search_after or scroll that is cleared
search.source(new SearchSourceBuilder().size(20).searchAfter(lastSort));
// if scroll is used: clearScroll(scrollId) in finally
```

---

## 25. Search writes: bulk with a stable document id; do not change existing mapping field types

Search writes should use bulk and a **stable document `_id`** (order id / business key). A missing or unstable id causes duplicates on retry. Changing an existing mapping field type is P1 (queries and old documents break). Missing `_id` on a new write path is P1; bulk-vs-single-doc on a non-critical index is P2.

```java
package com.example.order;

// ❌ no _id; mapping type change
index(new IndexRequest("orders").source(json));
// PUT /orders/_mapping { "amount": { "type": "text" } }  // was numeric

// ✅ stable id; do not change an existing field type
bulk.add(new IndexRequest("orders").id(order.getId()).source(json));
```

---

## 26. Wide-column / HBase-like Scan needs start+stop

Do not run a full-table `Scan` on a wide-column store. Set start and stop row keys. Do not use a timestamp-only row-key prefix (hotspot writes and unbounded scans). This rule names no ops platform.

```java
package com.example.order;

// ❌ full-table scan; timestamp-only prefix
Scan scan = new Scan();
Scan hot = new Scan().setRowPrefixFilter(Bytes.toBytes(String.valueOf(ts)));

// ✅ bounded start+stop; hash (or shard) prefix then the business key
Scan scan = new Scan()
    .withStartRow(startKey(customerId))
    .withStopRow(stopKey(customerId));
```

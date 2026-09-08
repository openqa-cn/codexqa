# Backend Incident Pattern Cards

> Neutral, reproducible patterns for CR citation (`INC-B01` onward). Not a second B-card set; details still live in `backend-service-rules.md` / `backend-data-access-rules.md`.
> Do not cite internal ticket numbers or real business names. Examples use `example.com` and `customerId`.

## 📋 Pattern quick-reference

| ID | Pattern | Related rule | Level |
|------|------|---------|------|
| INC-B01 | Feature flag inverted; all traffic took the new path | service §17 | P1 |
| INC-B02 | Write after a downstream failure | service §19 | P0 |
| INC-B03 | `hashCode()` as Map key overwrites data | service §18 | P1 |
| INC-B04 | Cache miss treated as a business-empty result | service §21 | P1 |
| INC-B05 | Remote config cannot roll back | service §22 | P1 |
| INC-B06 | Batch update missing selected IDs | data-access §11 | P0 |
| INC-B07 | Protocol merge accumulates unknown fields | service §23 | P1 |
| INC-B08 | Consume failure drops the message | service §21 | P1 |
| INC-B09 | Same-type parameters swapped | service §16 | P1 |
| INC-B10 | Tight retry with no backoff after failure | service §24 | P1 |

---

## INC-B01 Feature flag inverted

**Scenario**: Checkout’s new path is grayed with a remote flag. The condition is written as “miss takes the new path”; after release all traffic enters the new code and the old path is skipped.

```java
// ❌
if (!featureToggle.isEnabled("newCheckout")) {
    return newCheckout(req);
}
return legacyCheckout(req);

// ✅
if (featureToggle.isEnabled("newCheckout")) {
    return newCheckout(req);
}
return legacyCheckout(req);
```

**CR checkpoint**: Is the new branch taken only when `isEnabled` / `isInGray` is true? Does else explicitly take the old path?

---

## INC-B02 Write after a downstream failure

**Scenario**: Catalog times out and returns an empty object; order service still writes the empty snapshot into the order row; production shows “order without items”.

```java
Catalog catalog = catalogClient.get(skuId);
orderRepo.insert(Order.from(catalog)); // still writes when catalog failed

// ✅
if (catalog == null || !catalog.isOk()) {
    return Result.fail(ErrorCode.UPSTREAM);
}
orderRepo.insert(Order.from(catalog));
```

**CR checkpoint**: Is the write after every prerequisite succeeded? Does the failure path early-return?

---

## INC-B03 hashCode as Map key

**Scenario**: An aggregation/diff job uses `item.hashCode()` as the Map key; a collision lets the later write overwrite the earlier one and drops some customers.

```java
// ❌
byHash.put(row.hashCode(), row);

// ✅
byId.put(row.getCustomerId(), row);
```

**CR checkpoint**: Is the aggregate / dedup key a stable business ID?

---

## INC-B04 Cache miss treated as a business-empty result

**Scenario**: Node config is read-through cache. After cold start or expiry, get is null; the caller treats that as “no config”, skips validation, and the rule is disabled.

```java
NodeConfig config = cache.get(key);
return config; // null on miss

// ✅ on miss, load from source and backfill; see service §21
```

**CR checkpoint**: Is null “this row does not exist” or “not in cache”? The latter must load from source.

---

## INC-B05 Remote config cannot roll back

**Scenario**: Config JSON adds a required new field. After a code rollback, the old process throws deserializing the new config; every request 500s.

```java
// ❌ parse fails immediately when the old class has no new field
apply(parse(remoteConfig.get("order.process")));

// ✅ missing fields use defaults; parse failure uses RemoteConfig.defaults()
```

**CR checkpoint**: Can old code read the current config? Do new fields have defaults?

---

## INC-B06 Batch update missing selected IDs

**Scenario**: Ops selects 11 licenses and changes the applicable site. SQL updates `site_id` only, with no `id IN (selected)`; every license in the table is changed.

```java
// ❌
licenseMapper.updateSiteForAll(newSiteId);

// ✅
if (ids.isEmpty()) throw new IllegalArgumentException("ids required");
licenseMapper.updateSiteByIds(newSiteId, ids);
```

**CR checkpoint**: Does the batch-write WHERE equal the caller’s set? Can an empty list become a full-table update?

---

## INC-B07 Protocol merge bloat

**Scenario**: Old and new processes coexist during gray. New fields are unknown to the old process; each merge write-back stacks unknown, and the value bloats until unusable.

**CR checkpoint**: Does the read/write path “read-modify-write merge the same binary”? When versions coexist, do new fields have defaults, and does the old process only ignore unknown rather than write it back?

---

## INC-B08 Consume failure drops the message

**Scenario**: A queue message carries extension JSON. A broken extension field throws for the whole consume; the broker skips or marks success, and the main notification is lost.

```java
// ❌ parse ext fails and throws; the main message is never sent
Map<String, Object> ext = JSON.parseObject(task.getExt(), Map.class);
pushService.send(task, ext);

// ✅ ext can degrade to an empty map; main-flow failure goes to dead-letter; see service §21
```

**CR checkpoint**: Do recoverable failures go back to the queue? Do unrecoverable ones go to dead-letter? Can sidecar JSON degrade?

---

## INC-B09 Same-type parameters swapped

**Scenario**: `notify(customerId, orderId)` is called as `notify(orderId, customerId)`; it compiles, and the notification goes to the wrong subject.

**CR checkpoint**: Were two consecutive same-type parameters changed to an object? Do argument names at the call site match the parameters?

---

## INC-B10 Tight retry with no backoff after failure

**Scenario**: Settlement downstream rate-limits. The caller catches and immediately retries recursively, turning the limit into a stampede.

```java
// ❌
try { settle(req); } catch (Exception e) { settle(req); }

// ✅ retryable codes only, finite attempts, with backoff (service §13 / §24)
```

**CR checkpoint**: Does retry inspect the error code, and is there a cap and backoff?

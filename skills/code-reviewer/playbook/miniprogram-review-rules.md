# Mini-Program Review Rules

> Load when the diff touches mini-program source: `*.wxml`, `*.wxss`, `*.wxs`, `*.axml`, `*.acss`, `app.json`, and host JS that calls `setData` / `wx.*` / `my.*`.
> Examples use `example.com` and `customerId`. Style and layout issues are **P2**. White screens, leaked secrets, and privacy APIs called without consent are **P1/P0**.

## 📋 Rule Quick-Reference Index (scan this table first, then read details as needed)

| Section | Rule | Severity | Quick identification |
|------|------|------|------------|
| §1 | Batch `setData` / path updates | P1 | Multiple `setData` in a loop; writing back the whole `data` tree |
| §2 | Non-render data must not go to the view | P1 | `setData({ timer, cache })` |
| §3 | Image size and lazy load | P2 | Large local images; list `<image>` without `lazy-load` |
| §4 | Long lists and stable keys | P1 | `wx:for` / `a:for` without a key; hundreds of rows at once |
| §5 | Avoid unconditional re-renders | P2 | Unconditional `setData` / full fetch in `onShow` |
| §6 | Package size | P1 | Main-package static assets grow; subpackages not used when they could be |
| §7 | First screen and placeholders | P2 | First request in `onReady`; no skeleton/placeholder |
| §8 | Flat `data` | P2 | `data` nested 3+ levels |
| §9 | Cross-page state | P2 | Passing large objects via the page stack; abusing `globalData` |
| §10 | Storage | P1 | Storage holds tokens/IDs; no expiry |
| §11 | Input validation | P1 | Form submitted with no length/format checks |
| §12 | Authorization APIs | P1 | Phone/location APIs called before authorization |
| §13 | HTTPS only; tokens in headers | P1 | `http://`; `?token=` |
| §14 | Do not hide secrets on the frontend | P0 | Hardcoded app secrets / API keys (see G5) |
| §15 | Extract reusable UI into components | P2 | Same template copied across pages |
| §16 | Event naming and `catch` | P2 | Using `bind` when bubbling should be stopped; complex inline expressions in templates |
| §17 | Lifecycle cleanup | P1 | Timer started in `onLoad` not cleared in `onUnload` |
| §18 | WXS syntax subset | P2 | Unsupported ES2015+ used in WXS |
| §19 | Requests must have `fail` | P1 | `wx.request` / `my.request` without `fail` |
| §20 | Page-stack depth | P1 | Deep `navigateTo` chains; `redirectTo`/`switchTab` not used when they should be |

---

## 1. Batch setData / Path Updates

`setData` communicates to the view layer. Calling `setData` per item in a loop, or writing back the whole `data` tree, causes jank.

```js
// ❌
for (let i = 0; i < list.length; i += 1) {
  this.setData({ [`list[${i}].checked`]: true });
}
this.setData({ allData: this.data.allData });

// ✅ batch once; path updates change only the fields that changed
this.setData({
  'list[0].name': 'Ada',
  name: 'test',
  status: 'active',
});
```

---

## 2. Non-Render Data Must Not Go to the View

Timers, caches, request handles, and other values that are not bound in the template belong on the instance, not in `setData`.

```js
// ❌
this.setData({ timer: setTimeout(() => {}, 1000), cache: {} });

// ✅
this._timer = setTimeout(() => {}, 1000);
this._cache = {};
```

---

## 3. Image Size and Lazy Load

List images should go through a CDN with size parameters; use `lazy-load`. Prefer network images over packing them into the main package. Style/size optimizations are **P2**; main-package over the host limit is covered in §6.

```html
<image src="{{imgUrl}}" lazy-load mode="aspectFill" />
```

---

## 4. Long Lists and Stable Keys

When rendering many rows at once, use pagination or a windowed list. `wx:for` / `a:for` must have a stable `wx:key` / `a:key` (do not use index when the list can grow or shrink).

```html
<!-- ❌ -->
<view wx:for="{{list}}">{{item.name}}</view>

<!-- ✅ -->
<view wx:for="{{displayList}}" wx:key="customerId">{{item.name}}</view>
```

---

## 5. Avoid Unconditional Re-renders

When the host supports it, mark pure-data fields with `pureDataPattern`; do not `setData` values that `observers` can compute. Do not unconditionally refresh everything in `onShow`.

---

## 6. Package Size

Follow the **host platform docs** for main-package / total-package size limits. Serve static assets from a CDN, use subpackages for independent pages, and do not pull unused large libraries for a single page. Main package clearly over the limit, or subpackages not used when they could be → **P1**.

---

## 7. First Screen and Placeholders

Put the first-screen request in `onLoad` (do not wait for `onReady`). Use a skeleton or placeholder to reduce the sense of a white screen. Heavy sync work on the first screen → **P2**.

---

## 8. Flat data

Avoid nesting `data` more than three levels; path updates and diffs are more stable.

```js
// ❌
data: { user: { info: { basic: { name: '', age: 0 } } } }

// ✅
data: { userName: '', userAge: 0, orderStatus: '' }
```

---

## 9. Cross-Page State

Share cross-page state through an explicit global module or store. Do not stuff large objects into the page-stack URL, and do not dump unbounded business state into `getApp().globalData`.

---

## 10. Storage

`wx.setStorage` / `my.setStorage` (or the host equivalent) must have an expiry policy; do not cache passwords, long-lived tokens, or government-issued ID numbers. Sensitive data in Storage → **P1** (secret literals still go through G5 **P0**). Honor the host quotas for a single key and for total size.

---

## 11. Input Validation

Validate user input for length and format on both client and server. The frontend must at least reject empty values and obviously illegal formats; escape untrusted text and do not inject it as HTML into `rich-text`.

---

## 12. Authorization APIs

Getting a phone number, location, media library, etc. must check authorization first and handle denial. Calling a privacy API without authorization → **P1**.

```js
// ✅ authorize first, then call
wx.getSetting({
  success(res) {
    if (res.authSetting['scope.userLocation']) {
      wx.getLocation({ type: 'wgs84', success, fail });
    } else {
      wx.authorize({ scope: 'scope.userLocation', success, fail });
    }
  },
});
```

---

## 13. HTTPS Only; Tokens in Headers

Requests must use `https://`. Do not put long-lived login state in the URL query (same rule as the security playbook).

```js
// ❌
wx.request({ url: 'http://api.example.com/orders?access_token=' + token });

// ✅
wx.request({
  url: 'https://api.example.com/orders',
  header: { Authorization: 'Bearer ' + token },
});
```

---

## 14. Do Not Hide Secrets on the Frontend

Mini-program packages can be unpacked. Do not hardcode app secrets, payment secrets, or private keys. Literal hits go through cheat sheet **G5 / P0**.

---

## 15. Extract Reusable UI into Components

Copying the same WXML/WXSS (or AXML/ACSS) across pages → extract a custom component. Record as **P2**.

---

## 16. Event Naming and catch

To stop bubbling, use `catchtap` and other `catch*`, not `bind*`. Handler names use a `handle` / `on` prefix. Avoid complex inline expressions in templates (move them to WXS or JS). Record as **P2**.

---

## 17. Lifecycle Cleanup

Initialize in `onLoad` / `attached`; release timers, listeners, and media in `onUnload` / `detached`. `onShow` must not repeat one-time initialization already done in `onLoad`. Leaks → **P1**.

---

## 18. WXS Syntax Subset

Heavy view-layer computation can go in WXS, but use only the syntax subset documented for WXS (do not treat it as full ES2015+). Record as **P2**.

---

## 19. Requests Must Have fail

`wx.request` / `my.request` / payment and upload APIs must handle both the business code **and** `fail` (network failure). Missing `fail`, or success callbacks that ignore `statusCode` → **P1**.

```js
wx.request({
  url: 'https://api.example.com/data',
  success(res) {
    if (res.statusCode === 200 && res.data && res.data.code === 0) {
      this.setData({ items: res.data.items });
    } else {
      wx.showToast({ title: 'Load failed', icon: 'none' });
    }
  },
  fail() {
    wx.showToast({ title: 'Network error', icon: 'none' });
  },
});
```

---

## 20. Page-Stack Depth

Honor the host page-stack limit. Use `redirectTo` when the current page should not stay on the stack; use `switchTab` for tab pages. Consecutive `navigateTo` with no back-out path → **P1**.

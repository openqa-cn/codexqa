/**
 * Value semantics carried over from the original Python implementation.
 *
 * Much of the validation logic was ported from Python and relies on its
 * truthiness rules, where an empty list, dict, or string is falsy. JavaScript
 * treats `[]` and `{}` as truthy, so a direct `if (value)` port silently
 * changes behaviour. Keep using this helper wherever the ported rules ask
 * "did the caller actually supply anything here".
 */
export function py_bool(v: any): boolean {
  if (v == null || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Set || v instanceof Map) return v.size > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

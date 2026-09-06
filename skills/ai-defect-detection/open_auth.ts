import { AuthenticationError } from "./providers/auth/base.ts";
import { get_auth, set_manual_token } from "./providers/registry.ts";

export { AuthenticationError };

export const TOKEN_HEADER_KEY = "access_token";

export function set_token(token_str: string): void {
  let raw = (token_str || "").trim();
  if (raw.includes("=") && !raw.toLowerCase().startsWith("bearer ")) {
    raw = raw.split("=").slice(1).join("=").trim();
  }
  set_manual_token(raw);
}

function _token_from_headers(): string {
  const headers = get_auth().headers();
  if (!headers) return "";
  for (const value of Object.values(headers)) return value;
  return "";
}

export function refresh_token(): string | null {
  const auth = get_auth();
  if (auth.refresh()) return _token_from_headers();
  return null;
}

export function load_token(): string | null {
  try {
    return _token_from_headers() || "local";
  } catch (e) {
    if (e instanceof AuthenticationError) return null;
    throw e;
  }
}

export function extract_user_id(_token_str = ""): string {
  const user = get_auth().user_id();
  if (user) return user;
  return process.env.DETECTION_USER || "local-user";
}

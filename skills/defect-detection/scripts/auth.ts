import { get_auth, set_manual_token } from "./providers/registry.ts";

export function set_token(token_str: string): void {
  let raw = (token_str || "").trim();
  if (raw.includes("=") && !raw.toLowerCase().startsWith("bearer ")) {
    raw = raw.split("=").slice(1).join("=").trim();
  }
  set_manual_token(raw);
}

export function extract_user_id(): string {
  const user = get_auth().user_id();
  if (user) return user;
  return process.env.DETECTION_USER || "local-user";
}

import { AuthenticationError, BaseAuthProvider } from "./base.ts";

export class BearerAuthProvider extends BaseAuthProvider {
  _token: string;
  _header_name: string;
  _prefix: string;
  _user_id: string;

  constructor(options: Record<string, any> | null = null) {
    super();
    options = options || {};
    this._token = String(
      options.token || process.env.DETECTION_TOKEN || process.env.DETECTION_ACCESS_TOKEN || "",
    ).trim();
    this._header_name = options.header || "Authorization";
    this._prefix = options.prefix ?? "Bearer ";
    this._user_id = options.user_id || process.env.DETECTION_USER || "";
  }

  set_token(token: string): void {
    this._token = (token || "").trim();
  }

  headers(): Record<string, string> {
    if (!this._token) {
      throw new AuthenticationError("No access token configured. Set DETECTION_TOKEN or pass --token.");
    }
    let value = this._token.toLowerCase().startsWith("bearer ")
      ? this._token
      : `${this._prefix}${this._token}`;
    if (this._header_name.toLowerCase() !== "authorization") value = this._token;
    return { [this._header_name]: value };
  }

  user_id(): string {
    return this._user_id;
  }
}

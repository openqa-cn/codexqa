import { AuthenticationError, BaseAuthProvider } from "./base.ts";

export class ApiKeyAuthProvider extends BaseAuthProvider {
  _api_key: string;
  _header_name: string;
  _user_id: string;

  constructor(options: Record<string, any> | null = null) {
    super();
    options = options || {};
    this._api_key = String(options.api_key || process.env.DETECTION_API_KEY || "").trim();
    this._header_name = options.header || "X-API-Key";
    this._user_id = options.user_id || process.env.DETECTION_USER || "";
  }

  set_token(token: string): void {
    this._api_key = (token || "").trim();
  }

  headers(): Record<string, string> {
    if (!this._api_key) {
      throw new AuthenticationError("No API key configured. Set DETECTION_API_KEY or pass --token.");
    }
    return { [this._header_name]: this._api_key };
  }

  user_id(): string {
    return this._user_id;
  }
}

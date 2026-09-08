export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export interface AuthProvider {
  headers(): Record<string, string>;
  user_id(): string;
  refresh(): boolean;
  set_token?(token: string): void;
}

export class BaseAuthProvider implements AuthProvider {
  headers(): Record<string, string> {
    return {};
  }
  user_id(): string {
    return "";
  }
  refresh(): boolean {
    return false;
  }
}

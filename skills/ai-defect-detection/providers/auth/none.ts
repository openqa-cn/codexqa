import { BaseAuthProvider } from "./base.ts";

export class NoneAuthProvider extends BaseAuthProvider {
  headers(): Record<string, string> {
    return {};
  }
  user_id(): string {
    return "local-user";
  }
}

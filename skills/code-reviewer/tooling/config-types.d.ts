export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH';

export type AuthType = 'none' | 'bearer' | 'basic' | 'header' | 'query';

export interface AuthConfig {
  type: AuthType;
  tokenEnv?: string;
  usernameEnv?: string;
  passwordEnv?: string;
  headerName?: string;
  queryParam?: string;
  required?: boolean;
}

export interface HttpEndpoint {
  enabled: boolean;
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  auth: AuthConfig;
  timeoutMs: number;
}

export interface ReviewerConfig {
  version: number;
  git: {
    defaultBaseBranch: string;
    codeBrowseUrlTemplate: string;
  };
  layers: {
    ui: string[];
    store: string[];
    api: string[];
    backend: string[];
    exclude: string[];
  };
  conventions: {
    stateLibrary: string;
    httpWrapper: string;
    generatedGlobs: string[];
    generatedMarkers: string[];
    backendLanguage: string;
  };
  integrations: {
    prMetadata: HttpEndpoint;
    notify: HttpEndpoint;
    telemetry: HttpEndpoint;
    extraKnowledge: HttpEndpoint;
    [name: string]: HttpEndpoint;
  };
}

export interface ConfigSource {
  path: string;
  role: 'project';
}

export interface LoadedConfig {
  source: string;
  sources: ConfigSource[];
  config: ReviewerConfig;
}

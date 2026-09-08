#!/usr/bin/env node
/** Enterprise adapter runtime for testdata-generation. */

import { AuthAdapter } from "./auth.ts";
import { loadConfig, resolvePackRoot, resolveSkillDir, Config } from "./config.ts";
import { SkillMarketplace } from "./skill_marketplace.ts";
import { ToolRegistry } from "./tool_registry.ts";
import { ApiCatalog } from "./api_catalog.ts";
import { ExperienceStore } from "./experience_store.ts";
import { DataStore } from "./data_store.ts";
import { ConfigStore } from "./config_store.ts";
import { FeatureFlags } from "./feature_flags.ts";
import { DocSource } from "./doc_source.ts";
import { CaseWriteback } from "./case_writeback.ts";
import { WorkspaceContext } from "./workspace_context.ts";

export {
  loadConfig,
  resolvePackRoot,
  resolveSkillDir,
  Config,
  AuthAdapter,
  SkillMarketplace,
  ToolRegistry,
  ApiCatalog,
  ExperienceStore,
  DataStore,
  ConfigStore,
  FeatureFlags,
  DocSource,
  CaseWriteback,
  WorkspaceContext,
};

export class AdapterRuntime {
  cfg: Config;
  auth: AuthAdapter;
  skill_marketplace: SkillMarketplace;
  tool_registry: ToolRegistry;
  api_catalog: ApiCatalog;
  experience_store: ExperienceStore;
  data_store: DataStore;
  config_store: ConfigStore;
  feature_flags: FeatureFlags;
  doc_source: DocSource;
  case_writeback: CaseWriteback;
  workspace_context: WorkspaceContext;

  constructor(cfg: Config) {
    this.cfg = cfg;
    this.auth = new AuthAdapter(cfg);
    this.skill_marketplace = new SkillMarketplace(cfg, this.auth);
    this.tool_registry = new ToolRegistry(cfg, this.auth);
    this.api_catalog = new ApiCatalog(cfg, this.auth);
    this.experience_store = new ExperienceStore(cfg, this.auth);
    this.data_store = new DataStore(cfg);
    this.config_store = new ConfigStore(cfg, this.auth);
    this.feature_flags = new FeatureFlags(cfg, this.auth);
    this.doc_source = new DocSource(cfg, this.auth);
    this.case_writeback = new CaseWriteback(cfg, this.auth);
    this.workspace_context = new WorkspaceContext(cfg, this.auth);
  }
}

export function buildRuntime(configPath?: string | null): AdapterRuntime {
  return new AdapterRuntime(loadConfig(configPath));
}

export { buildRuntime as build_runtime };

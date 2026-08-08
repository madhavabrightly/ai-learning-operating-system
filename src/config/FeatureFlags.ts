export type FeatureFlagName =
  | 'documents'
  | 'knowledgeGraph'
  | 'assistant'
  | 'notebook'
  | 'plugins'
  | 'analytics'
  | 'websocketRealtime'
  | 'experimentalAiPipeline';

export interface FeatureFlagState {
  flags: Record<FeatureFlagName, boolean>;
  overrides: Partial<Record<FeatureFlagName, boolean>>;
}

const DEFAULT_FLAGS: Record<FeatureFlagName, boolean> = {
  documents: true,
  knowledgeGraph: true,
  assistant: true,
  notebook: true,
  plugins: false,
  analytics: false,
  websocketRealtime: false,
  experimentalAiPipeline: false,
};

const STORAGE_KEY = 'aios-feature-flags';

function getEnvFlag(name: FeatureFlagName): boolean | undefined {
  const envKey = `VITE_FF_${name.toUpperCase()}`;
  const value = import.meta.env?.[envKey];
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function loadOverrides(): Partial<Record<FeatureFlagName, boolean>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<FeatureFlagName, boolean>>) : {};
  } catch {
    return {};
  }
}

export function saveOverrides(overrides: Partial<Record<FeatureFlagName, boolean>>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // ignore
  }
}

export function getInitialFeatureFlags(): FeatureFlagState {
  const overrides = loadOverrides();
  const flags = { ...DEFAULT_FLAGS };
  for (const name of Object.keys(flags) as FeatureFlagName[]) {
    const env = getEnvFlag(name);
    if (env !== undefined) {
      flags[name] = env;
    } else if (overrides[name] !== undefined) {
      flags[name] = overrides[name]!;
    }
  }
  return { flags, overrides };
}

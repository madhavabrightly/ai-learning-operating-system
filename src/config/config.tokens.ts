export const CONFIG_TOKENS = {
  appName: Symbol('appName'),
  environment: Symbol('environment'),
  logLevel: Symbol('logLevel'),
  enableDeveloperMode: Symbol('enableDeveloperMode'),
  socketMode: Symbol('socketMode'),
  backendUrl: Symbol('backendUrl'),
} as const;

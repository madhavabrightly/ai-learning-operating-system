export type Environment = 'development' | 'test' | 'production';
export type SocketMode = 'websocket' | 'http';

export interface AppConfig {
  appName: string;
  environment: Environment;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enableDeveloperMode: boolean;
  socketMode: SocketMode;
  backendUrl: string;
}

export const createAppConfig = (overrides?: Partial<AppConfig>): AppConfig => ({
  appName: 'AI Learning Operating System',
  environment: (import.meta.env.VITE_APP_ENV as Environment) ?? 'development',
  logLevel: (import.meta.env.VITE_LOG_LEVEL as AppConfig['logLevel']) ?? 'debug',
  enableDeveloperMode: import.meta.env.VITE_ENABLE_DEV_MODE === 'true' || true,
  socketMode: (import.meta.env.VITE_SOCKET_MODE as SocketMode) ?? 'http',
  backendUrl: (import.meta.env.VITE_BACKEND_URL as string) ?? 'http://localhost:8787',
  ...overrides,
});

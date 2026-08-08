import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { EventTopics } from '@/events/EventTopics';
import type { IEventBus } from '@/events/types';
import { type FeatureFlagName, type FeatureFlagState, getInitialFeatureFlags, saveOverrides } from '@/config/FeatureFlags';
import type { StoreApi, UseBoundStore } from 'zustand';

export type { StoreApi, UseBoundStore };

export interface UIState {
  sidebarOpen: boolean;
  developerMode: boolean;
  featureFlags: FeatureFlagState;
  activePanel: string | null;
  notifications: UINotification[];
}

export interface UINotification {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

export interface UIActions {
  toggleSidebar: () => void;
  toggleDeveloperMode: () => void;
  setFeatureFlag: (name: FeatureFlagName, value: boolean) => void;
  isEnabled: (name: FeatureFlagName) => boolean;
  setActivePanel: (panel: string | null) => void;
  addNotification: (notification: Omit<UINotification, 'id'>) => void;
  dismissNotification: (id: string) => void;
}

export type UIStore = UIState & UIActions;
export type UIZustandApi = UseBoundStore<StoreApi<UIStore>>;

export interface CreateUIStoreOptions {
  initial?: Partial<UIState>;
  eventBus?: IEventBus;
}

export const createUIStore = ({ initial = {}, eventBus }: CreateUIStoreOptions = {}) => {
  return create<UIStore>()(
    persist(
      (set, get) => ({
        sidebarOpen: initial.sidebarOpen ?? true,
        developerMode: initial.developerMode ?? false,
        featureFlags: initial.featureFlags ?? getInitialFeatureFlags(),
        activePanel: initial.activePanel ?? null,
        notifications: initial.notifications ?? [],

        toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
        toggleDeveloperMode: () =>
          set((state) => {
            const next = !state.developerMode;
            eventBus?.publish(EventTopics.DEVELOPER_MODE_TOGGLED, { enabled: next });
            return { developerMode: next };
          }),
        setFeatureFlag: (name, value) => {
          set((state) => {
            const overrides = { ...state.featureFlags.overrides, [name]: value };
            saveOverrides(overrides);
            const next: FeatureFlagState = {
              flags: { ...state.featureFlags.flags, [name]: value },
              overrides,
            };
            eventBus?.publish(EventTopics.FEATURE_FLAG_CHANGED, { name, value });
            return { featureFlags: next };
          });
        },
        isEnabled: (name) => Boolean(get().featureFlags.flags[name]),
        setActivePanel: (panel) => set({ activePanel: panel }),
        addNotification: (notification) =>
          set((state) => ({
            notifications: [...state.notifications, { ...notification, id: self.crypto.randomUUID() }],
          })),
        dismissNotification: (id) =>
          set((state) => ({
            notifications: state.notifications.filter((n) => n.id !== id),
          })),
      }),
      {
        name: 'aios-ui',
        partialize: (state) => ({ sidebarOpen: state.sidebarOpen, developerMode: state.developerMode }),
      },
    ),
  );
};

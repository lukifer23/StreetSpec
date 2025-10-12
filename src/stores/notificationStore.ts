import { create } from 'zustand';

export type NotificationKind = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  kind: NotificationKind;
  title?: string;
  message: string;
  timeoutMs?: number;
}

interface NotificationState {
  notifications: Notification[];
  pushNotification: (notification: Omit<Notification, 'id'> & { id?: string }) => string;
  dismissNotification: (id: string) => void;
  clear: () => void;
}

const DEFAULT_TIMEOUT_MS = 6000;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  pushNotification: (notification) => {
    const id = notification.id ?? crypto.randomUUID();
    const entry: Notification = {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      ...notification,
      id,
    };

    set((state) => ({
      notifications: [...state.notifications, entry],
    }));

    return id;
  },
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((notification) => notification.id !== id),
    })),
  clear: () => set({ notifications: [] }),
}));

export const pushNotification = (notification: Omit<Notification, 'id'> & { id?: string }) =>
  useNotificationStore.getState().pushNotification(notification);

export const dismissNotification = (id: string) =>
  useNotificationStore.getState().dismissNotification(id);

import React, { useEffect } from 'react';
import { dismissNotification, useNotificationStore } from '../stores/notificationStore';

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 16,
  right: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  zIndex: 10_000,
  maxWidth: 320,
};

const getNotificationStyle = (kind: string): React.CSSProperties => {
  const base: React.CSSProperties = {
    borderRadius: 8,
    padding: '12px 16px',
    color: '#fff',
    boxShadow: '0 8px 20px rgba(0,0,0,0.18)',
    backdropFilter: 'blur(4px)',
  };

  switch (kind) {
    case 'success':
      return { ...base, backgroundColor: 'rgba(46, 204, 113, 0.92)' };
    case 'warning':
      return { ...base, backgroundColor: 'rgba(241, 196, 15, 0.95)' };
    case 'error':
      return { ...base, backgroundColor: 'rgba(231, 76, 60, 0.95)' };
    default:
      return { ...base, backgroundColor: 'rgba(52, 152, 219, 0.9)' };
  }
};

const closeButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
};

export const Notifications: React.FC = () => {
  const notifications = useNotificationStore((state) => state.notifications);

  useEffect(() => {
    const timeouts = notifications.map((notification) => {
      if (!notification.timeoutMs) {
        return undefined;
      }

      const timeout = setTimeout(() => dismissNotification(notification.id), notification.timeoutMs);
      return timeout;
    });

    return () => {
      timeouts.forEach((timeout) => {
        if (timeout) clearTimeout(timeout);
      });
    };
  }, [notifications]);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div style={containerStyle} role="region" aria-live="polite">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          style={{
            ...getNotificationStyle(notification.kind),
            position: 'relative',
          }}
        >
          <button
            type="button"
            onClick={() => dismissNotification(notification.id)}
            aria-label="Dismiss notification"
            style={closeButtonStyle}
          >
            ×
          </button>
          {notification.title && (
            <div style={{ fontWeight: 600, marginBottom: notification.message ? 4 : 0 }}>
              {notification.title}
            </div>
          )}
          <div>{notification.message}</div>
        </div>
      ))}
    </div>
  );
};

export default Notifications;

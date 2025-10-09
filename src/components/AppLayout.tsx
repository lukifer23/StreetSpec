import React from 'react';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  header: React.ReactNode;
  sidebar: React.ReactNode;
  mapArea: React.ReactNode;
  calibrationNotification?: React.ReactNode;
  statusBanner?: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  header,
  sidebar,
  mapArea,
  calibrationNotification,
  statusBanner,
}) => {
  return (
    <div className={styles['appContainer']}>
      {calibrationNotification}
      {header}
      {statusBanner}
      <div className={styles['mainContent']}>
        {sidebar}
        {mapArea}
      </div>
    </div>
  );
};

import React from 'react';
import { useProjectStore } from '../stores/projectStore';
import styles from './RevisionHistory.module.css';

const RevisionHistory: React.FC = () => {
  const { projects, currentProjectId, revertToRevision } = useProjectStore();
  const project = currentProjectId ? projects[currentProjectId] : null;

  if (!project) {
    return null;
  }

  return (
    <div className={styles['container']}>
      <h4>Revision History</h4>
      <ul className={styles['revisionList']}>
        {project.revisionHistory.map((revision) => (
          <li key={revision.timestamp}>
            <span>{new Date(revision.timestamp).toLocaleString()}</span>
            <button onClick={() => revertToRevision(revision.timestamp)}>Revert</button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default RevisionHistory;

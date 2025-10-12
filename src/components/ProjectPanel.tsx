import React, { useState, useEffect, useCallback } from 'react';
import { useProjectStore } from '../stores/projectStore';
import RevisionHistory from './RevisionHistory';
import styles from './ProjectPanel.module.css';

interface ProjectPanelProps {
  onClose: () => void;
}

const ProjectPanel: React.FC<ProjectPanelProps> = ({ onClose }) => {
  const { projects, createProject, loadProject, deleteProject, currentProjectId, saveRevision } = useProjectStore();
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    // Load projects from the main process when the component mounts
    useProjectStore.getState().loadProjects();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleCreateProject = () => {
    if (newProjectName.trim()) {
      createProject(newProjectName);
      setNewProjectName('');
    }
  };

  return (
    <div className={styles['container']}>
      <div className={styles['header']}>
        <h3>Projects</h3>
        <button onClick={handleClose} className={styles['closeButton']}>Close</button>
      </div>
      <div className={styles['newProject']}>
        <input
          type="text"
          value={newProjectName}
          onChange={(e) => setNewProjectName(e.target.value)}
          placeholder="New project name"
        />
        <button onClick={handleCreateProject}>Create</button>
      </div>
      <ul className={styles['projectList']}>
        {Object.values(projects).map((project) => (
          <li key={project.id} className={project.id === currentProjectId ? styles['active'] : ''}>
            <span onClick={() => loadProject(project.id)}>{project.name}</span>
            <button onClick={() => deleteProject(project.id)}>Delete</button>
          </li>
        ))}
      </ul>
      {currentProjectId && (
        <div>
          <button onClick={() => saveRevision()}>Save Revision</button>
          <RevisionHistory />
        </div>
      )}
    </div>
  );
};

export default ProjectPanel;

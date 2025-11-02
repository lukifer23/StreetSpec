import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useRootStore, useProjectActions } from '../stores/rootStore';
import RevisionHistory from './RevisionHistory';
import styles from './ProjectPanel.module.css';

interface ProjectPanelProps {
  onClose: () => void;
}

interface ProjectItemProps {
  project: { id: string; name: string };
  isActive: boolean;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}

const ProjectItem = memo<ProjectItemProps>(({ project, isActive, onLoad, onDelete }) => {
  const handleLoad = useCallback(() => {
    onLoad(project.id);
  }, [project.id, onLoad]);

  const handleDelete = useCallback(() => {
    if (window.confirm(`Delete project "${project.name}"?`)) {
      onDelete(project.id);
    }
  }, [project.id, project.name, onDelete]);

  return (
    <li className={isActive ? styles['active'] : ''}>
      <span onClick={handleLoad}>{project.name}</span>
      <button onClick={handleDelete}>Delete</button>
    </li>
  );
});

ProjectItem.displayName = 'ProjectItem';

const ProjectPanel: React.FC<ProjectPanelProps> = ({ onClose }) => {
  const projects = useRootStore((state) => state.projects);
  const currentProjectId = useRootStore((state) => state.currentProjectId);
  const {
    loadProjects,
    createProject,
    loadProject,
    deleteProject,
    saveRevision,
    saveCurrentProject,
  } = useProjectActions();
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    // Load projects from the main process when the component mounts
    loadProjects();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loadProjects, onClose]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleCreateProject = useCallback(() => {
    if (newProjectName.trim()) {
      createProject(newProjectName.trim());
      setNewProjectName('');
    }
  }, [newProjectName, createProject]);

  const handleLoadProject = useCallback((id: string) => {
    loadProject(id);
  }, [loadProject]);

  const handleDeleteProject = useCallback((id: string) => {
    deleteProject(id);
  }, [deleteProject]);

  const handleSaveProject = useCallback(async () => {
    await saveCurrentProject();
  }, [saveCurrentProject]);

  const handleSaveRevision = useCallback(async () => {
    await saveRevision();
  }, [saveRevision]);

  // Memoize project list for performance
  const projectList = useMemo(() => {
    return Object.values(projects).map((project) => (
      <ProjectItem
        key={project.id}
        project={project}
        isActive={project.id === currentProjectId}
        onLoad={handleLoadProject}
        onDelete={handleDeleteProject}
      />
    ));
  }, [projects, currentProjectId, handleLoadProject, handleDeleteProject]);

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
        {projectList}
      </ul>
      {currentProjectId && (
        <div>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <button onClick={handleSaveProject}>Save Project</button>
            <button onClick={handleSaveRevision}>Save Revision</button>
          </div>
          <RevisionHistory />
        </div>
      )}
    </div>
  );
};

export default ProjectPanel;

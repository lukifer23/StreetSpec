import React, { useState, useEffect } from 'react';
import { useProjectStore } from '../stores/projectStore';
import RevisionHistory from './RevisionHistory';
import styles from './ProjectPanel.module.css';

const ProjectPanel: React.FC = () => {
  const { projects, createProject, loadProject, deleteProject, currentProjectId, saveRevision } = useProjectStore();
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    // Load projects from the main process when the component mounts
    useProjectStore.getState().loadProjects();
  }, []);

  const handleCreateProject = () => {
    if (newProjectName.trim()) {
      createProject(newProjectName);
      setNewProjectName('');
    }
  };

  return (
    <div className={styles['container']}>
      <h3>Projects</h3>
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

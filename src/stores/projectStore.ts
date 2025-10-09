import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Measurement, Project, Revision } from '../types/common';

interface ProjectState {
  projects: Record<string, Project>;
  currentProjectId: string | null;
  loadProjects: () => Promise<void>;
  createProject: (name: string) => void;
  loadProject: (id: string) => void;
  deleteProject: (id: string) => void;
  addMeasurement: (measurement: Omit<Measurement, 'id' | 'timestamp' | 'name'>) => void;
  saveRevision: () => void;
  revertToRevision: (timestamp: number) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: {},
  currentProjectId: null,
  loadProjects: async () => {
    if (window.electronAPI?.invoke) {
      const projects = await window.electronAPI.invoke('get-projects');
      set({ projects });
    }
  },
  createProject: (name) => {
    const id = uuidv4();
    const newProject: Project = {
      id,
      name,
      measurements: [],
      revisionHistory: [],
    };
    const projects = { ...get().projects, [id]: newProject };
    set({ projects, currentProjectId: id });
    if (window.electronAPI?.invoke) {
      window.electronAPI.invoke('save-project', newProject);
    }
  },
  loadProject: (id) => {
    set({ currentProjectId: id });
  },
  deleteProject: (id) => {
    const projects = { ...get().projects };
    delete projects[id];
    set({ projects });
    if (window.electronAPI?.invoke) {
      window.electronAPI.invoke('delete-project', id);
    }
  },
  addMeasurement: (measurement) => {
    const { currentProjectId, projects } = get();
    if (!currentProjectId) return;

    const newMeasurement: Measurement = {
      ...measurement,
      id: uuidv4(),
      timestamp: Date.now(),
      name: '',
    };

    const updatedProject = {
      ...projects[currentProjectId],
      measurements: [...projects[currentProjectId].measurements, newMeasurement],
    };

    const updatedProjects = { ...projects, [currentProjectId]: updatedProject };
    set({ projects: updatedProjects });

    if (window.electronAPI?.invoke) {
      window.electronAPI.invoke('save-project', updatedProject);
    }
  },
  saveRevision: () => {
    const { currentProjectId, projects } = get();
    if (!currentProjectId) return;

    const project = projects[currentProjectId];
    const newRevision: Revision = {
      timestamp: Date.now(),
      measurements: project.measurements,
    };

    const updatedProject = {
      ...project,
      revisionHistory: [...project.revisionHistory, newRevision],
    };

    const updatedProjects = { ...projects, [currentProjectId]: updatedProject };
    set({ projects: updatedProjects });

    if (window.electronAPI?.invoke) {
      window.electronAPI.invoke('save-project', updatedProject);
    }
  },
  revertToRevision: (timestamp) => {
    const { currentProjectId, projects } = get();
    if (!currentProjectId) return;

    const project = projects[currentProjectId];
    const revision = project.revisionHistory.find(r => r.timestamp === timestamp);
    if (!revision) return;

    const updatedProject = {
      ...project,
      measurements: revision.measurements,
    };

    const updatedProjects = { ...projects, [currentProjectId]: updatedProject };
    set({ projects: updatedProjects });

    if (window.electronAPI?.invoke) {
      window.electronAPI.invoke('save-project', updatedProject);
    }
  },
}));

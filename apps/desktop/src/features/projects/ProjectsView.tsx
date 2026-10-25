import type { ProjectSummary } from "@framescout/contracts";
import { Settings } from "lucide-react";
import { type UiLanguage, uiCopy } from "../../i18n/uiCopy";

interface ProjectsViewProps {
  language: UiLanguage;
  projects: ProjectSummary[];
  onNewReview: () => void;
  onOpenProject: (projectId: string) => void;
}

export function ProjectsView({ language, projects, onNewReview, onOpenProject }: ProjectsViewProps) {
  const text = uiCopy[language].projects;
  return (
    <section className="projects-view" aria-label={text.region}>
      <div className="projects-hero">
        <div>
          <p className="eyebrow">{text.eyebrow}</p>
          <h1>{text.title}</h1>
        </div>
        <button className="primary-action" onClick={onNewReview}>{text.newReview}</button>
      </div>
      <div className="project-strip">
        {projects.map((project) => (
          <button className="project-tile" key={project.id} onClick={() => onOpenProject(project.id)}>
            <img src={project.coverUrl} alt="" />
            <span className="project-tile-meta">
              <strong>{project.name}</strong>
              <span>{project.sourceFolder}</span>
              <span>{project.reviewed}/{project.total} {text.reviewed} · {project.selected} {text.selected} · {project.aiRejects} {text.aiRejects}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="compact-actions">
        <button>{text.openExisting}</button>
        <button><Settings size={16} /> {text.settings}</button>
      </div>
    </section>
  );
}

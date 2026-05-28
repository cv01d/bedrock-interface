import { Router } from "express";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "../db/repo.js";
import {
  NoSummarizerModelError,
  SummarizeBusyError,
  summarizeProject,
} from "../services/summarizer.js";
import { explainBedrockError } from "../bedrock/errors.js";

export const projectsRouter = Router();

projectsRouter.get("/", (_req, res) => {
  res.json(listProjects());
});

projectsRouter.post("/", (req, res) => {
  const name = (req.body?.name ?? "").toString().trim() || "Untitled project";
  res.status(201).json(createProject(name));
});

projectsRouter.get("/:id", (req, res) => {
  const project = getProject(Number(req.params.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(project);
});

projectsRouter.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!getProject(id)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const { name, systemPrompt, projectData, rollingSummary } = req.body ?? {};
  const updated = updateProject(id, {
    name,
    systemPrompt,
    projectData,
    rollingSummary,
  });
  res.json(updated);
});

projectsRouter.delete("/:id", (req, res) => {
  deleteProject(Number(req.params.id));
  res.status(204).end();
});

projectsRouter.post("/:id/summarize", async (req, res) => {
  const id = Number(req.params.id);
  if (!getProject(id)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  try {
    const summary = await summarizeProject(id);
    res.json({ rollingSummary: summary, project: getProject(id) });
  } catch (err) {
    if (err instanceof SummarizeBusyError) {
      res.status(409).json({ error: err.message });
    } else if (err instanceof NoSummarizerModelError) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(502).json({
        error: explainBedrockError(
          err instanceof Error ? err.message : String(err)
        ),
      });
    }
  }
});

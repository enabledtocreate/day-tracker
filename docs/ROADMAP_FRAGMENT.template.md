# ROADMAP Fragment Template

This document defines the required structure for `ROADMAP_FRAGMENT_*.md`.

## Compliance Rules

- Keep the `APM:DATA` managed block intact and valid JSON.
- Keep the top compliance note intact.
- Do not edit `ROADMAP.md` directly when proposing roadmap changes through AI-assisted workflows.
- Use stable IDs when referring to existing features, phases, and tasks.
- Keep Mermaid text valid.

## Version

- Template Name: `ROADMAP_FRAGMENT.template.md`
- Template Version: `1.0`
- Last Updated: `2026-03-28`
- AI Agent instruction: Whenever this template is updated, update the template version and last updated date before changing anything else.

## Model Context Protocol

- `ROADMAP_FRAGMENT_*.md` is a proposal document, not the canonical roadmap.
- The application database is the source of truth.
- The application reads this fragment, stores it in SQLite, and can integrate the approved changes into roadmap phases, feature assignments, and task assignments.
- Use feature IDs from `FEATURES.md`.
- Use task IDs from the Kanban/Gantt task system.
- Prefer existing phase IDs or phase codes when modifying an existing phase.

## Required Managed Payload Shape

The managed block should include a `fragment.payload` object with these fields:

- `summary`: string
- `phaseChanges`: array of objects
- `featureAssignments`: array of objects
- `taskAssignments`: array of objects

Expected object shapes:

- `phaseChanges[]`
  - `id` or `code`
  - `name`
  - `goal`
  - `summary`
  - `status`
  - `targetDate`
  - `sortOrder`
- `featureAssignments[]`
  - `featureId`
  - `roadmapPhaseId` or `roadmapPhaseCode`
  - optional `status`
  - optional `archived`
  - optional `note`
- `taskAssignments[]`
  - `taskId`
  - `roadmapPhaseId` or `roadmapPhaseCode`
  - optional `note`

## Required Markdown Sections

The fragment markdown body should contain these sections in order:

1. `## Executive Summary`
2. `## Proposed Phase Changes`
3. `## Proposed Feature Assignments`
4. `## Proposed Task Assignments`
5. `## Integration Guidance`
6. `## Mermaid`

## AI Agent Instruction

- Create or update a roadmap fragment instead of editing `ROADMAP.md` directly.
- Keep the fragment compliant with this template.
- Put structural change intent in the managed payload.
- Use the human-readable markdown body to explain why the roadmap changes are being proposed.

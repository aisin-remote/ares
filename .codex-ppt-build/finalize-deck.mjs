import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileBlob, PresentationFile } from '@oai/artifact-tool';

const WORKSPACE = 'D:/fabian/00_Project/AI Project/ares';
const SKILL_DIR = 'C:/Users/fabian/.codex/plugins/cache/openai-primary-runtime/presentations/26.1015.12040/skills/presentations';
const RUNTIME_PYTHON = 'C:/Users/fabian/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const SOURCE_PPTX = 'C:/Users/fabian/Downloads/Presentation1.pptx';
const SOURCE_SHA256 = '1d5eab8b4a845b67ff572068bf7c24e4a60b7bab2148ae472ca7155ffcf887b3';
const DRAFT_PPTX = path.join(WORKSPACE, '.codex-ppt-build', 'draft-complete-v3', 'ARES-End-to-End-Flow-Complete-v3-draft.pptx');
const FINAL_PPTX = path.join(WORKSPACE, 'output', 'ARES-End-to-End-Flow-Complete-v3.pptx');
const STAGING_DIR = path.join(WORKSPACE, '.codex-ppt-build', 'finalizer-complete-v3');

const { finalizePresentation } = await import(pathToFileURL(
  path.join(SKILL_DIR, 'container_tools', 'artifact_tool_utils.mjs'),
).href);

await fs.mkdir(STAGING_DIR, { recursive: true });
await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });
const presentation = await PresentationFile.importPptx(await FileBlob.load(DRAFT_PPTX));
const candidatePath = path.join(STAGING_DIR, 'candidate.pptx');
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);

const requirements = {
  explicitTotalSlideCount: 11,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [],
};

const result = await finalizePresentation({
  ...requirements,
  workspaceDir: WORKSPACE,
  candidatePath,
  finalPath: FINAL_PPTX,
  pythonExecutable: RUNTIME_PYTHON,
  integrityValidatorPath: path.join(SKILL_DIR, 'container_tools', 'inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(SKILL_DIR, 'container_tools', 'inspect_presentation_layout_geometry.py'),
  layoutArgs: [
    '--expected-slide-size-emu', '12192000,6858000',
    '--validate-bullet-geometry',
    '--validate-heading-fit',
  ],
  requiredNativeTableOwnerSlides: [],
  fontPolicy: {
    basis: 'reference',
    families: ['Aptos'],
    referencePath: SOURCE_PPTX,
    referenceSha256: SOURCE_SHA256,
  },
  verifyArtifactToolImport: true,
  receiptPath: path.join(STAGING_DIR, 'ARES-End-to-End-Flow-Complete-v3.validation.json'),
});

console.log(JSON.stringify({ finalPath: FINAL_PPTX, result }, null, 2));

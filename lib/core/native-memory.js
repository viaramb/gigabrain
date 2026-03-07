import fs from 'node:fs';
import path from 'node:path';

import { normalizeContent } from './policy.js';

const HEADING_BY_TYPE = Object.freeze({
  PREFERENCE: 'Preferences',
  DECISION: 'Decisions',
  USER_FACT: 'User Facts',
  AGENT_IDENTITY: 'Agent Identity',
  ENTITY: 'Entities',
  EPISODE: 'Episodes',
  CONTEXT: 'Session Notes',
});

const MEMORY_LINK_RE = /\[m:[0-9a-f-]{8,}\]\s*/ig;
const BULLET_RE = /^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/;

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const headingForType = (type, durable) => {
  const normalizedType = String(type || '').trim().toUpperCase() || 'CONTEXT';
  if (!durable && (normalizedType === 'USER_FACT' || normalizedType === 'PREFERENCE')) return 'Remembered Today';
  return HEADING_BY_TYPE[normalizedType] || (durable ? 'Durable Notes' : 'Session Notes');
};

const normalizeBulletContent = (line) => {
  const match = String(line || '').match(BULLET_RE);
  const raw = String(match?.[1] || '').replace(MEMORY_LINK_RE, '').trim();
  return normalizeContent(raw);
};

const findExistingBulletLine = (lines, content) => {
  const target = normalizeContent(content);
  if (!target) return 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!BULLET_RE.test(String(lines[index] || ''))) continue;
    if (normalizeBulletContent(lines[index]) === target) return index + 1;
  }
  return 0;
};

const appendSectionAndBullet = ({ filePath, title, sectionHeading, bulletLine, content }) => {
  ensureDir(path.dirname(filePath));
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = existing ? existing.replace(/\r/g, '').split('\n') : [];
  const existingLine = findExistingBulletLine(lines, content);
  if (existingLine > 0) {
    return {
      written: false,
      line: existingLine,
    };
  }

  const appended = [];
  if (lines.length === 0) {
    appended.push(`# ${title}`, '', `## ${sectionHeading}`, '', bulletLine, '');
  } else {
    if (String(lines[lines.length - 1] || '').trim() !== '') appended.push('');
    const lastMeaningful = [...lines].reverse().find((line) => String(line || '').trim());
    if (String(lastMeaningful || '').trim() !== `## ${sectionHeading}`) {
      appended.push(`## ${sectionHeading}`, '');
    }
    appended.push(bulletLine, '');
  }

  const startLine = lines.length + 1;
  const lineNumber = startLine + appended.findIndex((line) => line === bulletLine);
  const merged = [...lines, ...appended].join('\n').replace(/\n{3,}$/g, '\n\n');
  fs.writeFileSync(filePath, `${merged.endsWith('\n') ? merged : `${merged}\n`}`, 'utf8');
  return {
    written: true,
    line: lineNumber,
  };
};

const writeNativeMemoryEntry = ({
  config,
  memoryId = '',
  type = 'CONTEXT',
  content = '',
  durable = false,
  timestamp = new Date().toISOString(),
} = {}) => {
  const note = String(content || '').trim();
  if (!note) {
    return {
      written: false,
      source_path: '',
      source_line: null,
      source_kind: durable ? 'memory_md' : 'daily_note',
    };
  }

  const dateKey = String(timestamp).slice(0, 10) || new Date().toISOString().slice(0, 10);
  const memoryRoot = String(config?.runtime?.paths?.memoryRoot || '').trim();
  const memoryMdPath = String(config?.native?.memoryMdPath || '').trim();
  const filePath = durable
    ? memoryMdPath
    : path.join(memoryRoot, `${dateKey}.md`);
  const sectionHeading = headingForType(type, durable);
  const bulletLine = memoryId
    ? `- [m:${memoryId}] ${note}`
    : `- ${note}`;
  const title = durable ? 'MEMORY' : dateKey;
  const result = appendSectionAndBullet({
    filePath,
    title,
    sectionHeading,
    bulletLine,
    content: note,
  });

  return {
    written: result.written,
    source_path: filePath,
    source_line: result.line,
    source_kind: durable ? 'memory_md' : 'daily_note',
    section: sectionHeading,
  };
};

export {
  headingForType,
  writeNativeMemoryEntry,
};

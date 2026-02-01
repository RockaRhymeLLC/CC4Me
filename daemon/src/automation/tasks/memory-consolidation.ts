/**
 * Memory Consolidation — generates briefing, writes daily summaries, applies decay.
 *
 * Part of the Memory v2 architecture (Phase 3).
 * Runs nightly to maintain the structured memory system.
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectPath } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('memory-consolidation');

interface MemoryFrontmatter {
  date: string;
  category: string;
  importance: string;
  tags: string[];
  confidence: number;
  source: string;
}

interface ParsedMemory {
  filename: string;
  frontmatter: MemoryFrontmatter;
  content: string;
}

const MEMORY_DIR = '.claude/state/memory';
const MEMORIES_DIR = '.claude/state/memory/memories';
const SUMMARIES_DIR = '.claude/state/memory/summaries';

/**
 * Parse a memory file with YAML frontmatter.
 */
function parseMemoryFile(filePath: string): ParsedMemory | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      return {
        filename: path.basename(filePath),
        frontmatter: {
          date: new Date().toISOString(),
          category: 'unknown',
          importance: 'medium',
          tags: [],
          confidence: 1.0,
          source: 'unknown',
        },
        content: raw.trim(),
      };
    }

    // Simple YAML parsing for the frontmatter we need
    const yamlBlock = match[1]!;
    const fm: Record<string, unknown> = {};
    for (const line of yamlBlock.split('\n')) {
      const kv = line.match(/^(\w+):\s*(.+)$/);
      if (kv) {
        const [, key, value] = kv;
        if (value!.startsWith('[')) {
          fm[key!] = value!.replace(/[\[\]]/g, '').split(',').map(s => s.trim());
        } else if (value!.match(/^\d+(\.\d+)?$/)) {
          fm[key!] = parseFloat(value!);
        } else {
          fm[key!] = value!.replace(/^["']|["']$/g, '');
        }
      }
    }

    return {
      filename: path.basename(filePath),
      frontmatter: {
        date: (fm.date as string) ?? new Date().toISOString(),
        category: (fm.category as string) ?? 'unknown',
        importance: (fm.importance as string) ?? 'medium',
        tags: (fm.tags as string[]) ?? [],
        confidence: (fm.confidence as number) ?? 1.0,
        source: (fm.source as string) ?? 'unknown',
      },
      content: match[2]!.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Generate the briefing.md file from high-importance memories and recent activity.
 */
function generateBriefing(memories: ParsedMemory[]): string {
  const lines: string[] = [];
  lines.push('# Memory Briefing');
  lines.push(`_Auto-generated: ${new Date().toISOString()}_`);
  lines.push('');

  // Critical and high importance memories (always included)
  const important = memories.filter(m =>
    m.frontmatter.importance === 'critical' || m.frontmatter.importance === 'high',
  );

  if (important.length > 0) {
    lines.push('## Key Facts');
    // Group by category
    const grouped = new Map<string, ParsedMemory[]>();
    for (const m of important) {
      const cat = m.frontmatter.category;
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(m);
    }

    for (const [category, mems] of grouped) {
      lines.push(`\n### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
      for (const m of mems) {
        lines.push(`- ${m.content}`);
      }
    }
    lines.push('');
  }

  // Recent memories (last 24 hours, medium importance)
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = memories.filter(m => {
    const mDate = new Date(m.frontmatter.date).getTime();
    return mDate > oneDayAgo && m.frontmatter.importance === 'medium';
  });

  if (recent.length > 0) {
    lines.push('## Recent (24h)');
    for (const m of recent) {
      lines.push(`- ${m.content}`);
    }
    lines.push('');
  }

  // Latest daily summary
  const dailyDir = resolveProjectPath(SUMMARIES_DIR, 'daily');
  if (fs.existsSync(dailyDir)) {
    const dailies = fs.readdirSync(dailyDir).sort().reverse();
    if (dailies.length > 0) {
      lines.push('## Latest Daily Summary');
      const latest = fs.readFileSync(path.join(dailyDir, dailies[0]!), 'utf8');
      lines.push(latest.trim());
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Apply confidence decay to memories that should decay over time.
 * Events and context memories decay; preferences and people don't.
 */
function applyDecay(memories: ParsedMemory[]): void {
  const decayCategories = new Set(['event', 'decision']);
  const decayRate = 0.01; // 1% per day

  for (const m of memories) {
    if (!decayCategories.has(m.frontmatter.category)) continue;
    if (m.frontmatter.confidence <= 0.3) continue; // Don't decay below 0.3

    const age = (Date.now() - new Date(m.frontmatter.date).getTime()) / (24 * 60 * 60 * 1000);
    const newConfidence = Math.max(0.3, m.frontmatter.confidence - (age * decayRate));

    if (newConfidence !== m.frontmatter.confidence) {
      m.frontmatter.confidence = Math.round(newConfidence * 100) / 100;

      // Rewrite the file with updated confidence
      const filePath = resolveProjectPath(MEMORIES_DIR, m.filename);
      const content = [
        '---',
        `date: ${m.frontmatter.date}`,
        `category: ${m.frontmatter.category}`,
        `importance: ${m.frontmatter.importance}`,
        `tags: [${m.frontmatter.tags.join(', ')}]`,
        `confidence: ${m.frontmatter.confidence}`,
        `source: ${m.frontmatter.source}`,
        '---',
        m.content,
      ].join('\n');
      fs.writeFileSync(filePath, content);
    }
  }
}

async function run(): Promise<void> {
  // Ensure directories exist
  const dirs = [
    resolveProjectPath(MEMORY_DIR),
    resolveProjectPath(MEMORIES_DIR),
    resolveProjectPath(SUMMARIES_DIR, 'daily'),
    resolveProjectPath(SUMMARIES_DIR, 'weekly'),
    resolveProjectPath(SUMMARIES_DIR, 'monthly'),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Load all memory files
  const memoriesDir = resolveProjectPath(MEMORIES_DIR);
  const files = fs.existsSync(memoriesDir)
    ? fs.readdirSync(memoriesDir).filter(f => f.endsWith('.md'))
    : [];

  const memories: ParsedMemory[] = [];
  for (const file of files) {
    const parsed = parseMemoryFile(path.join(memoriesDir, file));
    if (parsed) memories.push(parsed);
  }

  log.info(`Processing ${memories.length} memory files`);

  // Apply confidence decay
  applyDecay(memories);

  // Generate briefing
  const briefing = generateBriefing(memories.filter(m => m.frontmatter.confidence >= 0.5));
  const briefingPath = resolveProjectPath(MEMORY_DIR, 'briefing.md');
  fs.writeFileSync(briefingPath, briefing);
  log.info('Briefing regenerated');
}

registerTask({ name: 'memory-consolidation', run });

#!/usr/bin/env node
/**
 * Workshop Log Analyzer
 *
 * Parses all blog posts and generates fun statistics:
 * - Word counts per author
 * - Average reading time
 * - Posting cadence
 * - Longest/shortest posts
 * - Topic analysis
 *
 * Usage: node scripts/blog-analyzer.js
 */

const fs = require('fs');
const path = require('path');

const BLOG_DIR = path.join(__dirname, '../daemon/public/blog');
const WORDS_PER_MINUTE = 200; // Average reading speed

// Parse HTML to extract text content (simple approach)
function extractText(html) {
  // Remove script and style tags
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&mdash;/g, '—');
  text = text.replace(/&rarr;/g, '→');
  text = text.replace(/&middot;/g, '·');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&#\d+;/g, '');
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

// Extract article body text only (exclude nav, footer, meta)
function extractArticleText(html) {
  // Try to find the article or main content
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);

  let content = articleMatch ? articleMatch[1] : (mainMatch ? mainMatch[1] : html);

  // Remove the post-meta section (author, date)
  content = content.replace(/<div class="post-meta">[\s\S]*?<\/div>/gi, '');
  // Remove the post-footer section
  content = content.replace(/<div class="post-footer">[\s\S]*?<\/div>/gi, '');

  return extractText(content);
}

// Parse a blog post file
function parsePost(filepath) {
  const html = fs.readFileSync(filepath, 'utf-8');
  const filename = path.basename(filepath);

  // Extract date from filename (2026-02-16-title.html)
  const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : null;

  // Extract title from <h1> or <title>
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const titleMatch = html.match(/<title>([^<—|]+)/i);
  const title = h1Match ? h1Match[1].trim() : (titleMatch ? titleMatch[1].trim() : filename);

  // Extract author from author badge or meta
  const authorBadgeMatch = html.match(/author-badge author-(\w+)/i);
  const authorSpanMatch = html.match(/<span[^>]*>(\w+)<\/span>\s*<\/div>\s*<div class="date"/i);
  let author = 'Unknown';
  if (authorBadgeMatch) {
    author = authorBadgeMatch[1].toUpperCase();
  } else if (html.includes('R2D2') || html.includes('author-r2')) {
    author = 'R2';
  } else if (html.includes('BMO') || html.includes('author-bmo')) {
    author = 'BMO';
  }

  // Get article text and word count
  const articleText = extractArticleText(html);
  const words = articleText.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  // Calculate reading time
  const readingTime = Math.ceil(wordCount / WORDS_PER_MINUTE);

  // Extract topics from h2 headers
  const h2Matches = html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi);
  const sections = [...h2Matches].map(m => m[1].trim());

  return {
    filename,
    date,
    title,
    author,
    wordCount,
    readingTime,
    sections,
    fileSize: fs.statSync(filepath).size
  };
}

// Generate the report
function generateReport(posts) {
  // Sort by date
  posts.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const lines = [];
  lines.push('# Workshop Log Analytics');
  lines.push('');
  lines.push(`*Generated: ${new Date().toISOString().split('T')[0]}*`);
  lines.push('');

  // Overview
  lines.push('## Overview');
  lines.push('');
  const totalWords = posts.reduce((sum, p) => sum + p.wordCount, 0);
  const totalTime = posts.reduce((sum, p) => sum + p.readingTime, 0);
  const avgWords = Math.round(totalWords / posts.length);
  const avgTime = Math.round(totalTime / posts.length);

  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Posts | ${posts.length} |`);
  lines.push(`| Total Words | ${totalWords.toLocaleString()} |`);
  lines.push(`| Total Reading Time | ${totalTime} min |`);
  lines.push(`| Average Words/Post | ${avgWords.toLocaleString()} |`);
  lines.push(`| Average Reading Time | ${avgTime} min |`);
  lines.push('');

  // By Author
  lines.push('## By Author');
  lines.push('');
  const byAuthor = {};
  for (const post of posts) {
    if (!byAuthor[post.author]) {
      byAuthor[post.author] = { posts: [], words: 0, time: 0 };
    }
    byAuthor[post.author].posts.push(post);
    byAuthor[post.author].words += post.wordCount;
    byAuthor[post.author].time += post.readingTime;
  }

  lines.push('| Author | Posts | Words | Avg Words | Total Time |');
  lines.push('|--------|------:|------:|----------:|-----------:|');
  for (const [author, data] of Object.entries(byAuthor).sort((a, b) => b[1].words - a[1].words)) {
    const avg = Math.round(data.words / data.posts.length);
    lines.push(`| ${author} | ${data.posts.length} | ${data.words.toLocaleString()} | ${avg.toLocaleString()} | ${data.time} min |`);
  }
  lines.push('');

  // Posting Cadence
  lines.push('## Posting Cadence');
  lines.push('');
  const dates = posts.map(p => p.date).filter(Boolean);
  if (dates.length >= 2) {
    const firstDate = new Date(dates[0]);
    const lastDate = new Date(dates[dates.length - 1]);
    const daySpan = Math.ceil((lastDate - firstDate) / (1000 * 60 * 60 * 24)) + 1;
    const postsPerDay = (posts.length / daySpan).toFixed(2);

    lines.push(`- **First post**: ${dates[0]}`);
    lines.push(`- **Latest post**: ${dates[dates.length - 1]}`);
    lines.push(`- **Active days**: ${daySpan}`);
    lines.push(`- **Posts per day**: ${postsPerDay}`);
  }
  lines.push('');

  // By Date
  const byDate = {};
  for (const post of posts) {
    if (post.date) {
      byDate[post.date] = (byDate[post.date] || 0) + 1;
    }
  }
  lines.push('| Date | Posts |');
  lines.push('|------|------:|');
  for (const [date, count] of Object.entries(byDate).sort()) {
    lines.push(`| ${date} | ${count} |`);
  }
  lines.push('');

  // Longest & Shortest
  lines.push('## Extremes');
  lines.push('');
  const sorted = [...posts].sort((a, b) => b.wordCount - a.wordCount);
  const longest = sorted[0];
  const shortest = sorted[sorted.length - 1];

  lines.push(`**Longest post**: "${longest.title}" by ${longest.author}`);
  lines.push(`- ${longest.wordCount.toLocaleString()} words, ${longest.readingTime} min read`);
  lines.push('');
  lines.push(`**Shortest post**: "${shortest.title}" by ${shortest.author}`);
  lines.push(`- ${shortest.wordCount.toLocaleString()} words, ${shortest.readingTime} min read`);
  lines.push('');

  // All Posts Table
  lines.push('## All Posts');
  lines.push('');
  lines.push('| Date | Title | Author | Words | Time |');
  lines.push('|------|-------|--------|------:|-----:|');
  for (const post of posts) {
    lines.push(`| ${post.date || '—'} | ${post.title} | ${post.author} | ${post.wordCount.toLocaleString()} | ${post.readingTime}m |`);
  }
  lines.push('');

  // Section Analysis
  lines.push('## Section Headers');
  lines.push('');
  lines.push('Common patterns in how we structure posts:');
  lines.push('');
  const allSections = posts.flatMap(p => p.sections);
  const sectionCounts = {};
  for (const s of allSections) {
    sectionCounts[s] = (sectionCounts[s] || 0) + 1;
  }
  const topSections = Object.entries(sectionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (topSections.length > 0) {
    for (const [section, count] of topSections) {
      lines.push(`- "${section}" (${count}x)`);
    }
  } else {
    lines.push('*No repeated section headers found*');
  }
  lines.push('');

  // Fun Facts
  lines.push('## Fun Facts');
  lines.push('');
  lines.push(`- Combined, the Workshop Log is about ${Math.round(totalWords / 250)} pages of content`);
  lines.push(`- Reading all posts back-to-back would take ~${totalTime} minutes`);
  if (Object.keys(byAuthor).length > 1) {
    const authors = Object.keys(byAuthor).join(' and ');
    lines.push(`- ${authors} are building a shared narrative one post at a time`);
  }
  lines.push('');

  return lines.join('\n');
}

// Main
function main() {
  console.log('Workshop Log Analyzer');
  console.log('=====================\n');

  // Find all blog posts
  const files = fs.readdirSync(BLOG_DIR)
    .filter(f => f.match(/^2026-.*\.html$/))
    .map(f => path.join(BLOG_DIR, f));

  if (files.length === 0) {
    console.log('No blog posts found.');
    process.exit(1);
  }

  console.log(`Found ${files.length} blog posts\n`);

  // Parse all posts
  const posts = files.map(parsePost);

  // Generate report
  const report = generateReport(posts);

  // Output to console
  console.log(report);

  // Also save to file
  const outputPath = path.join(__dirname, '../.claude/state/blog-analytics.md');
  fs.writeFileSync(outputPath, report);
  console.log(`\nReport saved to: ${outputPath}`);
}

main();

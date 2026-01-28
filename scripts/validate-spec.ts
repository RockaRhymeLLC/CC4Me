#!/usr/bin/env tsx

/**
 * Spec Validation Script
 *
 * Validates that a specification file is complete and ready for planning.
 *
 * Checks:
 * - File exists and is readable
 * - All required sections are present
 * - Requirements are defined
 * - Success criteria are defined
 * - No unresolved open questions (or acknowledged)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface SpecRequirements {
  mustHave: string[];
  shouldHave: string[];
  wontHave: string[];
}

function parseSpec(content: string): {
  hasGoal: boolean;
  requirements: SpecRequirements;
  hasSuccessCriteria: boolean;
  successCriteria: string[];
  openQuestions: string[];
  hasConstraints: boolean;
} {
  const lines = content.split('\n');

  let hasGoal = false;
  let hasSuccessCriteria = false;
  let hasConstraints = false;
  const requirements: SpecRequirements = {
    mustHave: [],
    shouldHave: [],
    wontHave: []
  };
  const successCriteria: string[] = [];
  const openQuestions: string[] = [];

  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect sections
    if (trimmed.startsWith('## Goal')) {
      currentSection = 'goal';
      continue;
    } else if (trimmed.startsWith('### Must Have')) {
      currentSection = 'must-have';
      continue;
    } else if (trimmed.startsWith('### Should Have')) {
      currentSection = 'should-have';
      continue;
    } else if (trimmed.startsWith("### Won't Have")) {
      currentSection = 'wont-have';
      continue;
    } else if (trimmed.startsWith('## Success Criteria')) {
      currentSection = 'success-criteria';
      continue;
    } else if (trimmed.startsWith('## Open Questions')) {
      currentSection = 'open-questions';
      continue;
    } else if (trimmed.startsWith('## Constraints')) {
      currentSection = 'constraints';
      hasConstraints = true;
      continue;
    } else if (trimmed.startsWith('##')) {
      currentSection = '';
    }

    // Parse content based on section
    if (currentSection === 'goal' && trimmed && !trimmed.startsWith('#')) {
      hasGoal = true;
    } else if (currentSection === 'must-have' && trimmed.startsWith('- [ ]')) {
      requirements.mustHave.push(trimmed.substring(5).trim());
    } else if (currentSection === 'should-have' && trimmed.startsWith('- [ ]')) {
      requirements.shouldHave.push(trimmed.substring(5).trim());
    } else if (currentSection === 'wont-have' && trimmed.startsWith('- [ ]')) {
      requirements.wontHave.push(trimmed.substring(5).trim());
    } else if (currentSection === 'success-criteria') {
      if (trimmed && /^\d+\./.test(trimmed)) {
        successCriteria.push(trimmed);
        hasSuccessCriteria = true;
      }
    } else if (currentSection === 'open-questions' && trimmed.startsWith('- [ ]')) {
      openQuestions.push(trimmed.substring(5).trim());
    }
  }

  return {
    hasGoal,
    requirements,
    hasSuccessCriteria,
    successCriteria,
    openQuestions,
    hasConstraints
  };
}

function validateSpec(specPath: string): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: []
  };

  // Check file exists
  if (!existsSync(specPath)) {
    result.valid = false;
    result.errors.push(`Spec file not found: ${specPath}`);
    return result;
  }

  // Read and parse spec
  let content: string;
  try {
    content = readFileSync(specPath, 'utf-8');
  } catch (error) {
    result.valid = false;
    result.errors.push(`Failed to read spec file: ${error}`);
    return result;
  }

  const parsed = parseSpec(content);

  // Validate goal
  if (!parsed.hasGoal) {
    result.valid = false;
    result.errors.push('Spec is missing a goal statement');
  }

  // Validate requirements
  if (parsed.requirements.mustHave.length === 0) {
    result.valid = false;
    result.errors.push('Spec has no must-have requirements');
  }

  // Validate success criteria
  if (!parsed.hasSuccessCriteria || parsed.successCriteria.length === 0) {
    result.valid = false;
    result.errors.push('Spec has no success criteria defined');
  }

  // Check for open questions
  if (parsed.openQuestions.length > 0) {
    result.warnings.push(
      `Spec has ${parsed.openQuestions.length} unresolved open question(s):\n  - ${parsed.openQuestions.join('\n  - ')}`
    );
  }

  // Warnings for optional sections
  if (parsed.requirements.shouldHave.length === 0) {
    result.warnings.push('No should-have requirements defined (optional but recommended)');
  }

  if (!parsed.hasConstraints) {
    result.warnings.push('No constraints section found (optional but recommended)');
  }

  return result;
}

function printResults(result: ValidationResult, specPath: string): void {
  console.log(chalk.bold('\n📋 Spec Validation Results'));
  console.log(chalk.gray(`File: ${specPath}\n`));

  if (result.errors.length > 0) {
    console.log(chalk.red.bold('❌ Errors:'));
    result.errors.forEach(error => {
      console.log(chalk.red(`  - ${error}`));
    });
  }

  if (result.warnings.length > 0) {
    console.log(chalk.yellow.bold('\n⚠️  Warnings:'));
    result.warnings.forEach(warning => {
      console.log(chalk.yellow(`  - ${warning}`));
    });
  }

  if (result.valid) {
    console.log(chalk.green.bold('\n✅ Spec validation passed!\n'));
  } else {
    console.log(chalk.red.bold('\n❌ Spec validation failed!\n'));
    console.log(chalk.gray('Fix the errors above before proceeding to planning.\n'));
  }
}

// Main execution
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(chalk.red('Error: No spec file provided'));
    console.log(chalk.gray('Usage: tsx scripts/validate-spec.ts <spec-file-path>'));
    process.exit(1);
  }

  const specPath = resolve(args[0]);
  const result = validateSpec(specPath);

  printResults(result, specPath);

  process.exit(result.valid ? 0 : 1);
}

main();

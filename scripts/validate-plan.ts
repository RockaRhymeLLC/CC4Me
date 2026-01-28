#!/usr/bin/env tsx

/**
 * Plan Validation Script
 *
 * Validates that a plan file is complete and ready for building.
 *
 * Checks:
 * - File exists and is readable
 * - References a valid spec file
 * - All required sections are present
 * - Tasks are defined
 * - Test plan is defined
 * - Test files exist
 * - Rollback plan is documented
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import chalk from 'chalk';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface PlanData {
  specFile: string | null;
  hasTechnicalApproach: boolean;
  tasks: string[];
  testFiles: string[];
  hasTestPlan: boolean;
  hasRollbackPlan: boolean;
  hasValidationChecklist: boolean;
}

function parsePlan(content: string, planPath: string): PlanData {
  const lines = content.split('\n');
  const planDir = dirname(planPath);

  let specFile: string | null = null;
  let hasTechnicalApproach = false;
  let hasTestPlan = false;
  let hasRollbackPlan = false;
  let hasValidationChecklist = false;
  const tasks: string[] = [];
  const testFiles: string[] = [];

  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect sections
    if (trimmed.startsWith('**Spec**:') || trimmed.startsWith('Spec:')) {
      const match = trimmed.match(/specs\/[^\s)]+\.spec\.md/);
      if (match) {
        specFile = join(planDir, '..', match[0]);
      }
      continue;
    } else if (trimmed.startsWith('## Technical Approach')) {
      currentSection = 'technical-approach';
      hasTechnicalApproach = true;
      continue;
    } else if (trimmed.startsWith('## Tasks')) {
      currentSection = 'tasks';
      continue;
    } else if (trimmed.startsWith('## Test Plan')) {
      currentSection = 'test-plan';
      hasTestPlan = true;
      continue;
    } else if (trimmed.startsWith('## Rollback Plan')) {
      currentSection = 'rollback-plan';
      hasRollbackPlan = true;
      continue;
    } else if (trimmed.startsWith('## Validation Checklist')) {
      currentSection = 'validation-checklist';
      hasValidationChecklist = true;
      continue;
    } else if (trimmed.startsWith('##')) {
      currentSection = '';
    }

    // Parse content based on section
    if (currentSection === 'tasks' && trimmed.startsWith('- [ ]')) {
      tasks.push(trimmed.substring(5).trim());
    } else if (currentSection === 'test-plan') {
      // Look for test file references
      const testMatch = trimmed.match(/`(tests\/[^\`]+\.test\.ts)`/);
      if (testMatch) {
        const testFilePath = join(planDir, '..', testMatch[1]);
        if (!testFiles.includes(testFilePath)) {
          testFiles.push(testFilePath);
        }
      }
    }
  }

  return {
    specFile,
    hasTechnicalApproach,
    tasks,
    testFiles,
    hasTestPlan,
    hasRollbackPlan,
    hasValidationChecklist
  };
}

function validatePlan(planPath: string): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: []
  };

  // Check file exists
  if (!existsSync(planPath)) {
    result.valid = false;
    result.errors.push(`Plan file not found: ${planPath}`);
    return result;
  }

  // Read and parse plan
  let content: string;
  try {
    content = readFileSync(planPath, 'utf-8');
  } catch (error) {
    result.valid = false;
    result.errors.push(`Failed to read plan file: ${error}`);
    return result;
  }

  const parsed = parsePlan(content, planPath);

  // Validate spec reference
  if (!parsed.specFile) {
    result.valid = false;
    result.errors.push('Plan does not reference a spec file');
  } else if (!existsSync(parsed.specFile)) {
    result.valid = false;
    result.errors.push(`Referenced spec file not found: ${parsed.specFile}`);
  }

  // Validate technical approach
  if (!parsed.hasTechnicalApproach) {
    result.valid = false;
    result.errors.push('Plan is missing technical approach section');
  }

  // Validate tasks
  if (parsed.tasks.length === 0) {
    result.valid = false;
    result.errors.push('Plan has no tasks defined');
  }

  // Validate test plan
  if (!parsed.hasTestPlan) {
    result.valid = false;
    result.errors.push('Plan is missing test plan section');
  }

  // Check test files exist
  if (parsed.testFiles.length === 0) {
    result.warnings.push('No test files referenced in plan');
  } else {
    for (const testFile of parsed.testFiles) {
      if (!existsSync(testFile)) {
        result.errors.push(`Test file does not exist: ${testFile}`);
        result.valid = false;
      }
    }
  }

  // Validate rollback plan
  if (!parsed.hasRollbackPlan) {
    result.warnings.push('Plan is missing rollback plan section (recommended)');
  }

  // Validate validation checklist
  if (!parsed.hasValidationChecklist) {
    result.warnings.push('Plan is missing validation checklist (recommended)');
  }

  return result;
}

function printResults(result: ValidationResult, planPath: string): void {
  console.log(chalk.bold('\n📝 Plan Validation Results'));
  console.log(chalk.gray(`File: ${planPath}\n`));

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
    console.log(chalk.green.bold('\n✅ Plan validation passed!\n'));
  } else {
    console.log(chalk.red.bold('\n❌ Plan validation failed!\n'));
    console.log(chalk.gray('Fix the errors above before proceeding to build.\n'));
  }
}

// Main execution
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(chalk.red('Error: No plan file provided'));
    console.log(chalk.gray('Usage: tsx scripts/validate-plan.ts <plan-file-path>'));
    process.exit(1);
  }

  const planPath = resolve(args[0]);
  const result = validatePlan(planPath);

  printResults(result, planPath);

  process.exit(result.valid ? 0 : 1);
}

main();

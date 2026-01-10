#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import { fetchIssuesCommand } from './commands/fetch-issues.js';
import { fetchPRsCommand } from './commands/fetch-prs.js';
import { analyseReposCommand } from './commands/analyse-repos.js';

dotenv.config();

const program = new Command();

program.name('cli').description('GitHub Project CLI').version('1.0.0');

program.addCommand(fetchIssuesCommand);
program.addCommand(fetchPRsCommand);
program.addCommand(analyseReposCommand);

program.parse(process.argv);

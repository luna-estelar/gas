#!/usr/bin/env node
// The same command as @luna-estelar/gas-cli, which this package pins exactly:
// pnpm links only a direct dependency's bins, so the umbrella declares its own.
import { run } from '@luna-estelar/gas-cli';

run(process.argv.slice(2));

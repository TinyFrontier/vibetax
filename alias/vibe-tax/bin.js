#!/usr/bin/env node
import { main } from "vibetax/dist/cli.js";
process.exitCode = await main(process.argv.slice(2));

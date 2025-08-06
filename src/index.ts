import fs from 'fs';
import chalk from 'chalk';
import { snootyAstToMdast } from './snooty-ast-to-mdast';
import { mdastToMdx } from './mdast-to-mdx';

const [_, __, input] = process.argv;

if (!input) {
  console.log(chalk.red('Error: No input file provided'));
  printUsage();
  process.exit(1);
}

const isJson = input.endsWith('.json');
const isZip = input.endsWith('.zip');

if (!isJson && !isZip) {
  console.log(chalk.red('Error: Input file must end in .json or .zip'));
  printUsage();
  process.exit(1);
}

if (isJson) {
  console.log(chalk.magenta(`Converting ${chalk.yellow(input)} to MDX...`), '\n');

  const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
  // handle wrapper objects that store AST under `ast` field
  const snootyRoot = raw.ast ?? raw;

  const mdast = snootyAstToMdast(snootyRoot);
  const mdx = mdastToMdx(mdast);

  // handle sample data suffixes cleanly, fallback to .json if not found
  const inputSuffix = input.endsWith('_ast-input.json') ? '_ast-input.json' : '.json';

  const outputPath = input.replace(inputSuffix, '_output.mdx');
  fs.writeFileSync(outputPath, mdx);

  console.log(chalk.green(`✓ Wrote ${chalk.yellow(outputPath)}`), '\n');
} else {
  console.log(chalk.magenta(`Converting ${chalk.yellow(input)} to MDX...`), '\n');
}

function printUsage() {
  console.log(chalk.magenta('\nUsage:'));
  console.log(chalk.cyan('    pnpm start'), chalk.yellow('/path/to/ast-input.json'));
  console.log(chalk.cyan('    pnpm start'), chalk.yellow('/path/to/doc-site.zip'), '\n');
}

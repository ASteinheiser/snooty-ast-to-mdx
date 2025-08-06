import fs from 'fs';
import path from 'node:path';
import unzipper from 'unzipper';
import { BSON } from 'bson';
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

function printUsage() {
  console.log(chalk.magenta('\nUsage:'));
  console.log(chalk.cyan('    pnpm start'), chalk.yellow('/path/to/ast-input.json'));
  console.log(chalk.cyan('    pnpm start'), chalk.yellow('/path/to/doc-site.zip'), '\n');
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

  convertZipToMDX(input);
}

const IGNORED_FILE_SUFFIXES = ['.txt.bson', '.rst.bson'];

/** Convert a zip file to a folder of MDX files, preserving the zip's directory structure */
async function convertZipToMDX(input: string) {
  try {
    const zipDir = await unzipper.Open.file(input);

    const zipBaseName = path.basename(input, '.zip');
    fs.mkdirSync(zipBaseName);

    let writeCount = 0;
    for (const file of zipDir.files) {
      if (file.type !== 'File' || !file.path.endsWith('.bson') || IGNORED_FILE_SUFFIXES.some(suffix => file.path.endsWith(suffix))) {
        // Drain other entries to avoid back-pressure
        (file as any).autodrain?.();
        continue;
      }

      // Read the whole BSON file as a buffer
      const buf = await file.buffer();
      const docs: any[] = [];
      let offset = 0;
      while (offset < buf.length) {
        const size = buf.readInt32LE(offset);
        const slice = buf.subarray(offset, offset + size);
        docs.push(BSON.deserialize(slice));
        offset += size;
      }

      if (!docs.length) continue; // nothing to convert
      if (docs.length > 1) {
        console.log(chalk.yellow(
          `\nWarning: ${chalk.cyan(file.path)} contains ${chalk.cyan(docs.length)} BSON documents - only the first one will be converted to MDX.\n`
        ));
      }

      const document = docs[0];
      // handle wrapper objects that store AST under `ast` field
      const snootyRoot = document.ast ?? document;

      const mdast = snootyAstToMdast(snootyRoot);
      const mdx = mdastToMdx(mdast);

      const relativePath = file.path.replace('.bson', '.mdx');
      const outputPath = path.join(zipBaseName, relativePath);

      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, mdx);

      writeCount++;
      process.stdout.write(`\r${chalk.green(`✓ Wrote ${chalk.yellow(writeCount)} files`)}`);
    }

    console.log(chalk.green(`\n\n✓ Wrote folder ${chalk.yellow(zipBaseName + '/')}`), '\n');
  } catch (err) {
    console.error(chalk.red('Failed to process zip:'), err, '\n');
    process.exit(1);
  }
}

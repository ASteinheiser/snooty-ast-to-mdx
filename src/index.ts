import fs from 'fs';
import path from 'node:path';
import unzipper from 'unzipper';
import { BSON } from 'bson';
import chalk from 'chalk';
import { snootyAstToMdast } from './snooty-ast-to-mdast';
import { mdastToMdx } from './mdast-to-mdx';
import {
  buildReferencesTs,
  readExistingReferences,
  mergeReferences,
  normalizeToPosix,
} from './utils';

const [_, __, input, outputPrefix] = process.argv;

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
  console.log(chalk.cyan('    pnpm start'), chalk.yellow('/path/to/doc-site.zip'), chalk.gray('/optional/output/folder'), '\n');
}

let hasCreatedReferencesFile = false;

if (isJson) {
  console.log(chalk.magenta(`Converting ${chalk.yellow(input)} to MDX...`), '\n');

  const astTree = JSON.parse(fs.readFileSync(input, 'utf8'));
  // handle sample data suffixes cleanly, fallback to .json if not found
  const inputSuffix = input.endsWith('_ast-input.json') ? '_ast-input.json' : '.json';
  const outputPath = input.replace(inputSuffix, '_output.mdx');

  const fileCount = convertAstJsonToMdxFile(astTree, outputPath);
  const totalCount = fileCount + (hasCreatedReferencesFile ? 1 : 0);

  console.log(chalk.green(`✓ Wrote ${chalk.yellow(totalCount)} file${totalCount === 1 ? '' : 's'}`), '\n');
  if (hasCreatedReferencesFile) {
    const refsPath = path.join(path.dirname(outputPath), 'references.ts');
    console.log(chalk.green(`✓ Wrote ${chalk.yellow('./' + refsPath)}`), '\n');
  }
  console.log(chalk.green(`✓ Wrote ${chalk.yellow(outputPath)}`), '\n');
} else {
  console.log(chalk.magenta(`Converting ${chalk.yellow(input)} to MDX...`), '\n');

  convertZipToMdxFile(input, outputPrefix);
}

function convertAstJsonToMdxFile(tree: any, outputPath: string, outputRootDir?: string) {
  // handle wrapper objects that store AST under `ast` field
  const snootyRoot = tree.ast ?? tree;

  let fileCount = 0;
  const rootDir = outputRootDir ?? path.dirname(outputPath);
  const aggregated: { substitutions: Record<string, string>; refs: Record<string, { title: string; url: string }> } = { substitutions: {}, refs: {} };
  const mdast = snootyAstToMdast(snootyRoot, {
    onEmitMDXFile: (emitFilePath, mdastRoot) => {
      try {
        const outPath = path.join(rootDir, emitFilePath);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });

        const mdxContent = mdastToMdx(mdastRoot);
        fs.writeFileSync(outPath, mdxContent);
        fileCount++;

        const refs = mdastRoot.__references;
        if (refs) {
          Object.assign(aggregated.substitutions, refs.substitutions || {});
          Object.assign(aggregated.refs, refs.refs || {});
        }
      } catch (err) {
        console.error(chalk.red('Failed to emit include file:'), emitFilePath, err);
      }
    },
    // Make the current output file path relative to the provided output root directory
    currentOutfilePath: normalizeToPosix(path.relative(rootDir, outputPath)),
  });

  // If references were collected, emit or update a references.ts file at the output root
  const refsArtifact = mdast.__references;
  if (refsArtifact || Object.keys(aggregated.substitutions).length || Object.keys(aggregated.refs).length) {
    if (refsArtifact) {
      Object.assign(aggregated.substitutions, refsArtifact.substitutions || {});
      Object.assign(aggregated.refs, refsArtifact.refs || {});
    }
    const refsPath = path.join(rootDir, 'references.ts');
    fs.mkdirSync(path.dirname(refsPath), { recursive: true });
    const existing = fs.existsSync(refsPath) ? readExistingReferences(refsPath) : { substitutions: {}, refs: {} };
    const merged = mergeReferences(existing, aggregated);
    const file = buildReferencesTs(merged);
    fs.writeFileSync(refsPath, file);
    hasCreatedReferencesFile = true;
  }
  const mdx = mdastToMdx(mdast);

  fs.writeFileSync(outputPath, mdx);
  fileCount++;

  return fileCount;
}

/** some BSON files are not AST JSON, but rather raw text or RST */
const IGNORED_FILE_SUFFIXES = ['.txt.bson', '.rst.bson'] as const;

/** Convert a zip file to a folder of MDX files, preserving the zip's directory structure */
async function convertZipToMdxFile(input: string, outputPrefix?: string) {
  try {
    const zipDir = await unzipper.Open.file(input);

    const zipBaseNameRaw = path.basename(input, '.zip');
    const zipBaseName = outputPrefix ? path.join(outputPrefix, zipBaseNameRaw) : zipBaseNameRaw;
    fs.mkdirSync(zipBaseName, { recursive: true });

    // Map asset checksum (compressed filename) -> semantic key (e.g., /images/foo.png)
    const checksumToKey = new Map<string, string>();
    const seenAssetChecksums = new Set<string>();

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

      const astTree = docs[0];
      // Collect static asset mappings for this page, if present
      if (astTree && Array.isArray(astTree.static_assets)) {
        for (const asset of astTree.static_assets) {
          const checksum = asset?.checksum;
          const key = asset?.key;
          if (typeof checksum === 'string' && typeof key === 'string' && checksum && key) {
            checksumToKey.set(checksum, key);
          }
        }
      }
      const relativePath = file.path.replace('.bson', '.mdx');
      const outputPath = path.join(zipBaseName, relativePath);
      // ensure the (potentially nested) output directory exists
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      const fileCount = convertAstJsonToMdxFile(astTree, outputPath, zipBaseName);

      writeCount += fileCount;
      process.stdout.write(`\r${chalk.green(`✓ Wrote ${chalk.yellow(writeCount)} files`)}`);
    }

    // ensure new line to print static asset logs, don't overwrite file count logs
    console.log('\n');

    // Second pass: extract non-BSON files that correspond to collected checksums
    for (const file of zipDir.files) {
      if (file.type !== 'File' || file.path.endsWith('.bson')) {
        (file as any).autodrain?.();
        continue;
      }
      const base = path.basename(file.path);
      const semanticKey = checksumToKey.get(base);
      if (!semanticKey) {
        (file as any).autodrain?.();
        continue;
      }
      if (seenAssetChecksums.has(base)) {
        (file as any).autodrain?.();
        continue;
      }
      const buf = await file.buffer();
      const assetPath = semanticKey.replace(/^\/+/, '').replace(/\\+/g, '/');
      const outPath = path.join(zipBaseName, assetPath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buf);

      seenAssetChecksums.add(base);
      process.stdout.write(`\r${chalk.green(`✓ Wrote ${chalk.yellow(seenAssetChecksums.size)} static assets`)}`);
    }

    if (hasCreatedReferencesFile) {
      const refsPath = path.join(zipBaseName, 'references.ts');
      process.stdout.write(chalk.green(`\n\n✓ Wrote ${chalk.yellow(refsPath)}`));
    }

    console.log(chalk.green(`\n\n✓ Wrote folder ${chalk.yellow(zipBaseName + '/')}`), '\n');
  } catch (err) {
    console.error(chalk.red('Failed to process zip:'), err, '\n');
    process.exit(1);
  }
}

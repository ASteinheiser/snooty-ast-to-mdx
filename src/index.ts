import fs from 'fs';
import { snootyAstToMdast } from './snooty-ast-to-mdast';
import { mdastToMdx } from './mdast-to-mdx';

const main = async () => {
  const [_, __, input] = process.argv;

  if (!input) {
    console.error('Usage: pnpm start /path/to/ast-input.json');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
  // handle wrapper objects that store AST under `ast` field
  const snootyRoot = raw.ast ?? raw;

  const mdast = snootyAstToMdast(snootyRoot);
  const mdx = await mdastToMdx(mdast);

  const outputPath = input.replace('ast-input.json', 'output.mdx');
  fs.writeFileSync(outputPath, mdx);

  console.log(`Output written to ${outputPath}`);
};

main();

// @ts-nocheck
// Entry point re-exporting the converter. Intentionally minimal – this file
// can double as a tiny CLI when executed with tsx / ts-node.
import { snootyToMdast } from './converter';

export { snootyToMdast };

if (require.main === module) {
  const [_, __, input] = process.argv;

  if (!input) {
    console.error('Usage: tsx src/index.ts path/to/snooty-ast.json');
    process.exit(1);
  }

  const raw = JSON.parse(require('fs').readFileSync(input, 'utf8'));
  // handle wrapper objects that store AST under `ast` field
  const snootyRoot = raw.ast ?? raw;
  const mdast = snootyToMdast(snootyRoot);

  console.log(JSON.stringify(mdast, null, 2));
}

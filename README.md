# snooty-ast-to-mdast

This is a tool to convert Snooty AST to MDX AST. This uses Remark to convert the custom RST markdown represented as AST to mdast, which can then be converted to MDX.

## Use the CLI to convert a Snooty AST to MDX

```bash
pnpm install
pnpm dlx tsx src/index.ts ../path/to/ast.json > ../path/to/output.mdx
```

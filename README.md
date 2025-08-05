# snooty-ast-to-mdast

This is a tool to convert Snooty AST to MDX AST. This uses Remark to convert the custom RST markdown represented as AST to mdast, which can then be converted to MDX.

## Usage

```bash
tsx src/index.ts ~/path/to/ast.json > ~/path/to/output.mdx
```

## Test with sample data

```bash
pnpm install
pnpm dlx tsx src/index.ts ./sample-data/cloud-docs_atlas-cli_ast-output.json > ./sample-data/output.mdx
```

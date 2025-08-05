# snooty-ast-to-mdx

This is a tool to convert Snooty RST to `mdx`

- The process includes converting custom Snooty RST >> custom Snooty AST >> `mdast` >> `mdx`
- The conversion is not 1:1, due to differences in RST vs `mdx`
- Frontmatter is currently used as a replacement for Snooty's `<meta>` directive

### How it works

- Snooty parser is used to go from RST >> AST
- Remark is used to convert AST >> `mdast`
- Remark/mdx library is used to convert `mdast` >> `mdx`

## Usage

```bash
tsx src/index.ts ~/path/to/ast.json > ~/path/to/output.mdx
```

## Test with sample data

```bash
pnpm install
pnpm dlx tsx src/index.ts ./sample-data/cloud-docs_atlas-cli_ast-output.json > ./sample-data/output.mdx
```

# snooty-ast-to-mdx

**POC made for MongoDB - Docs Platform** 

This is a tool to convert custom [Snooty RST](https://github.com/mongodb/snooty-parser) to `mdx` by going from AST to MDAST, then using Remark/Frontmatter to get `mdx`.

- The process includes converting custom Snooty RST >> custom Snooty AST >> `mdast` >> `mdx`
- The conversion is not 1:1, due to differences in RST vs `mdx`
- Frontmatter is currently used as a replacement for Snooty's `<meta>` directive

### How it works

- Snooty parser is used to go from RST >> AST
- Custom mapping logic is applied to convert AST >> `mdast`
- Remark/Frontmatter is then used to convert `mdast` >> `mdx`

## Usage

```bash
tsx src/index.ts ~/path/to/ast.json > ~/path/to/output.mdx
```

## Test with sample data

```bash
pnpm install
pnpm dlx tsx src/index.ts ./sample-data/cloud-docs_atlas-cli_ast-output.json > ./sample-data/output.mdx
```

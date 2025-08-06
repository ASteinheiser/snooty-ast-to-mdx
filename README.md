# snooty-ast-to-mdx

This is a tool to convert custom [Snooty RST](https://github.com/mongodb/snooty-parser) to `mdx` by going from AST to MDAST, then using Remark/Frontmatter to get `mdx`.

- The process includes converting custom Snooty RST >> custom Snooty AST >> `mdast` >> `mdx`
- The conversion is not always 1:1, due to differences in RST vs `mdx`
  - Examples include: custom directives and substitutions, along with any custom parser features
  - Frontmatter is used as a replacement for Snooty's `<meta>` directive

### How it works

- Snooty parser is used to go from RST >> AST
- Custom mapping logic is applied to convert AST >> `mdast`
- Remark/Frontmatter is then used to convert `mdast` >> `mdx`

#### POC made for MongoDB - Docs Platform

Sample RST/AST inputs and MDX outputs are available in the `sample-data` folder.

**NOTE:** The full set of RST source files can be found in the [docs monorepo](https://github.com/mongodb/docs). These need to be parsed into AST json files, which can be done by following the [Developer Quickstart instructions here](https://github.com/mongodb/snooty?tab=readme-ov-file#developer-quickstart).

## Usage

```bash
pnpm install
pnpm start /path/to/ast-input.json
```

## Test with sample data

```bash
pnpm start ./sample-data/cloud-docs/atlas-cli_ast-input.json
```

## Possible Issues:

- lists (list node mismatch)
- code-block metadata loss
- field lists, tables, figures/images (not converted)
- substitution definitions
- named references
- include/cond behavior

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

**NOTE:** The full set of RST source files can be found in the [docs monorepo](https://github.com/mongodb/docs). In order to parse a docs site into a zip (and optionally extract JSON files), follow the [Developer Quickstart instructions here](https://github.com/mongodb/snooty?tab=readme-ov-file#developer-quickstart).

## Usage

```bash
pnpm install
pnpm start /path/to/ast-input.json
pnpm start /path/to/doc-site.zip
```

## Run with a json file

This will run the tool against a single json file, which represents a single page from a docs site. Docs sites are typically stored in a zip file, which we unzip to read BSON files, which get dumped to JSON files. Sample RST/AST inputs and MDX outputs are available in the `sample-data` folder.

```bash
pnpm start ./sample-data/cloud-docs/atlas-cli_ast-input.json
```

## Run with a zip file

This will run the tool against a zip file, which contains a single docs site (a collection of pages). This tool should output the entire site in MDX format in a folder which preserves the directory structure of the zip file. For example, if you had parsed the MongoDB Manual with Snooty Parser, you could run:

```bash
pnpm start /path/to/manual.zip
```

## Problem Areas:
- `Include`
  - need to parse the rst/txt file (currently there's an href link and data in-line)
  - possible solution: import mdx files that contain the include content
- `Literalinclude`
- `SubstitutionReference`
- `Ref`
- `Contents`
- `DefaultDomain`
- investigate handling `named_reference` (currently omitted)
- investigate images and how they're handled by the parser
- investigate conditional render blocks (maybe not a problem)

# snooty-ast-to-mdx

This is a tool to convert custom [Snooty RST](https://github.com/mongodb/snooty-parser) to `mdx` by going from AST to MDAST, then using Remark/Frontmatter to get `mdx`.

- The process includes converting custom Snooty RST >> custom Snooty AST >> `mdast` >> `mdx`
- The conversion is not always 1:1, due to differences in RST vs `mdx`
  - Examples include: substitutions, images, custom directives, etc.

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

This is a more contrived example, which will run the tool against a single json file, which represents a single page from a docs site. Docs sites are typically stored in a zip file, which we unzip to read BSON files, which get dumped to JSON files. Sample RST/AST inputs and MDX outputs are available in the `sample-data` folder.

```bash
pnpm start ./sample-data/cloud-docs/atlas-cli_ast-input.json
```

## Run with a zip file

This will run the tool against a zip file, which contains a single docs site (a collection of pages). This tool should output the entire site in MDX format (along with images and substitutions) in a folder which preserves the directory structure of the zip file. For example, if you had parsed the MongoDB Manual with Snooty Parser, you could run:

```bash
pnpm start /path/to/manual.zip
```

## Key changes:
- Frontmatter YAML (in the header of `mdx` files) is used as a replacement for Snooty's `<meta>` directive
  - other metadata, such as templates could be defined here
  - currently appears to have extra metadata that might be calculated by the parser
- `Figure` and `Image` components have their images stored in the top-level `images` folder
  - These images are referenced by ESM imports in the `mdx` files
- `Include` is replaced by ESM importing the shared `mdx` file
  - the contents are snippets of `mdx` content that can be shared across pages (similar to how snooty handles Includes)
- both of these are stored in a TS file that is ESM imported by the `mdx` files
  - `SubstitutionReference`s are just strings
  - `Ref`s are objects with a `title` and `url`
    - this probably needs to be reworked
- `Literalinclude`
  - this currently just emits a `TODO` comment
  - need to figure out where the source files are located
- ?? investigate handling `named_reference` (currently omitted)
- ?? possibly need to hide these
  - `Contents`
  - `DefaultDomain`

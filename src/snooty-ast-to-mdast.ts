import path from 'node:path';
import type { Node } from 'unist';

interface MdastNode extends Node {
  [key: string]: any;
}

// Flexible SnootyNode interface that matches what the parser actually produces
// The parser output doesn't strictly follow the types in ast.ts
interface SnootyNode {
  type: string;
  children?: SnootyNode[];
  value?: string;
  // Snooty specific properties we care about
  refuri?: string;
  language?: string;
  lang?: string;
  start?: number;
  startat?: number;
  depth?: number;
  title?: string;
  name?: string;
  argument?: SnootyNode[] | string;
  options?: Record<string, any>;
  enumtype?: 'ordered' | 'unordered';
  ordered?: boolean;
  label?: string;
  term?: SnootyNode[];
  html_id?: string;
  ids?: string[];
  refname?: string;
  target?: string;
  url?: string;
  domain?: string;
  admonition_type?: string;
  [key: string]: any;
}

type ConversionContext = {
  registerImport?: (componentName: string, importPath: string) => void;
  emitMDXFile?: (outfilePath: string, mdastRoot: MdastNode) => void;
  /** Relative path (POSIX) of the file currently being generated, e.g. 'includes/foo.mdx' */
  currentOutfilePath?: string;
};

/** Convert a list of Snooty nodes to a list of mdast nodes */
function convertChildren(nodes: SnootyNode[] | undefined, depth: number, ctx: ConversionContext): MdastNode[] {
  if (!nodes || !Array.isArray(nodes)) return [];
  return nodes
    .map((n) => convertNode(n, depth, ctx))
    .flat()
    .filter(Boolean) as MdastNode[];
}

/** Convert a single Snooty node to mdast. Certain nodes (e.g. `section`) expand
    into multiple mdast siblings, so the return type can be an array. */
function convertNode(node: SnootyNode, sectionDepth = 1, ctx: ConversionContext): MdastNode | MdastNode[] | null {
  switch (node.type) {
    case 'text':
      return { type: 'text', value: node.value ?? '' };

    case 'paragraph':
      return {
        type: 'paragraph',
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      };

    case 'emphasis':
      return {
        type: 'emphasis',
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      };

    case 'strong':
      return {
        type: 'strong',
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      };

    case 'literal': { // inline code in Snooty AST
      // Snooty's "literal" inline code nodes sometimes store their text in
      // child "text" nodes rather than the `value` property. Fall back to
      // concatenating child text nodes when `value` is missing so that we
      // don't emit empty inline code (``) in the resulting MDX.
      let value: string = node.value ?? '';
      if (!value && Array.isArray(node.children)) {
        value = node.children
          .filter((c): c is SnootyNode => !!c)
          .filter((c) => c.type === 'text' || 'value' in c)
          .map((c: any) => c.value ?? '')
          .join('');
      }
      return { type: 'inlineCode', value };
    }

    case 'code': // literal_block is mapped to `code` in frontend AST
    case 'literal_block': {
      let value = node.value ?? '';
      if (!value && Array.isArray(node.children)) {
        value = node.children.map((c: any) => c.value ?? '').join('');
      }
      return { type: 'code', lang: node.lang ?? node.language ?? null, value };
    }

    case 'bullet_list':
      return {
        type: 'list',
        ordered: false,
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      };

    case 'enumerated_list':
    case 'ordered_list':
      return {
        type: 'list',
        ordered: true,
        start: node.start ?? 1,
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      };

    case 'list_item':
    case 'listItem':
      return {
        type: 'listItem',
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      };

    // Parser-emitted generic list node (covers both ordered & unordered)
    case 'list': {
      const ordered = (typeof node.enumtype === 'string' ? node.enumtype === 'ordered' : !!node.ordered);
      const start = ordered ? (node.startat ?? node.start ?? 1) : undefined;
      const mdastList: MdastNode = {
        type: 'list',
        ordered,
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      };
      if (ordered && typeof start === 'number') {
        (mdastList as any).start = start;
      }
      return mdastList;
    }

    // Field list (definition list–like) support
    case 'field_list':
      return {
        type: 'mdxJsxFlowElement',
        name: 'FieldList',
        attributes: [],
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      } as MdastNode;

    case 'field': {
      const attributes: MdastNode[] = [];
      if (node.name) attributes.push({ type: 'mdxJsxAttribute', name: 'name', value: String(node.name) });
      if (node.label) attributes.push({ type: 'mdxJsxAttribute', name: 'label', value: String(node.label) });
      return {
        type: 'mdxJsxFlowElement',
        name: 'Field',
        attributes,
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      } as MdastNode;
    }

    // Basic table support - many table types from parser
    case 'table':
    case 'table_head':
    case 'table_body':
    case 'table_row':
    case 'table_cell': {
      const elementMap: Record<string, string> = {
        'table': 'Table',
        'table_head': 'TableHead',
        'table_body': 'TableBody',
        'table_row': 'TableRow',
        'table_cell': 'TableCell'
      };
      return {
        type: 'mdxJsxFlowElement',
        name: elementMap[node.type] || 'Table',
        attributes: [],
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      } as MdastNode;
    }

    case 'reference':
      if (node.refuri) {
        return {
          type: 'link',
          url: node.refuri,
          children: convertChildren(node.children ?? [], sectionDepth, ctx),
        };
      }
      // fallthrough: treat as plain children if no URI
      return convertChildren(node.children ?? [], sectionDepth, ctx);

    case 'section': {
      // Snooty frontend AST uses a `heading` child, parser AST may use `title`.
      const titleNode = (node.children ?? []).find((c) => c.type === 'title' || c.type === 'heading');
      const rest = (node.children ?? []).filter((c) => c !== titleNode);
      const mdast: MdastNode[] = [];

      if (titleNode) {
        mdast.push({
          type: 'heading',
          depth: Math.min(sectionDepth, 6),
          children: convertChildren(titleNode.children ?? [], sectionDepth, ctx),
        });
      }

      rest.forEach((child) => {
        const converted = convertNode(child, sectionDepth + 1, ctx);
        if (Array.isArray(converted)) mdast.push(...converted);
        else if (converted) mdast.push(converted);
      });

      return mdast;
    }

    case 'title':
    case 'heading':
      return {
        type: 'heading',
        depth: node.depth ?? Math.min(sectionDepth, 6),
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      };

    case 'directive': {
      const directiveName = String(node.name ?? '').toLowerCase();
      // Special-case <Meta> directives here: we collect them at root level.
      if (directiveName === 'meta') {
        // This node will be handled separately – skip here.
        return null;
      }
      // Render figure directive as an <Image /> with imported src
      if (directiveName === 'figure') {
        // Extract the path to the image from the directive's children or argument
        const extractPathFromNodes = (nodes: SnootyNode[] | undefined): string => {
          if (!Array.isArray(nodes)) return '';
          const parts: string[] = [];
          const walk = (n: SnootyNode) => {
            if (!n) return;
            if (typeof n.value === 'string') parts.push(n.value);
            if (Array.isArray(n.children)) n.children.forEach(walk);
          };
          nodes.forEach(walk);
          return parts.join('').trim();
        };

        const argText = Array.isArray(node.argument)
          ? node.argument.map((a: any) => a.value ?? '').join('')
          : (typeof node.argument === 'string' ? node.argument : '');

        let pathText = extractPathFromNodes(node.children) || String(argText || '');
        // Normalise path: drop any leading slash, de-escape backslashes
        // Some serialisers may escape dots like "\.png" – unescape those
        let assetPosix = pathText
          .replace(/\\+/g, '/')
          .replace(/^\/+/, '')
          .replace(/^\/+/, '')
          .replace(/^\.\//, '')
          .replace(/\\\./g, '.');
        if (!assetPosix) {
          // If no path, emit a harmless comment so conversion continues
          return { type: 'html', value: '<!-- figure missing src -->' } as MdastNode;
        }

        // Compute import path relative to the current MDX file being generated
        const importerPosix = (ctx.currentOutfilePath || 'index.mdx').replace(/\\+/g, '/');
        const importerDir = path.posix.dirname(importerPosix);

        // Heuristic: static images live under top-level `<root>/images/` or `<root>/<section>/images/`.
        // Determine the top-level section from the current outfile path (e.g., 'manual').
        const topLevel = importerPosix.includes('/') ? importerPosix.split('/')[0] : '';
        let targetPosix = assetPosix.replace(/^\/+/, '');
        const imagesIdx = targetPosix.indexOf('images/');
        if (imagesIdx >= 0) {
          const after = targetPosix.slice(imagesIdx + 'images/'.length);
          targetPosix = topLevel ? `${topLevel}/images/${after}` : `images/${after}`;
        } else if (assetPosix.startsWith('images/')) {
          const after = assetPosix.slice('images/'.length);
          targetPosix = topLevel ? `${topLevel}/images/${after}` : `images/${after}`;
        } else if (!targetPosix.includes('/')) {
          // Bare filename → place under top-level images
          targetPosix = topLevel ? `${topLevel}/images/${targetPosix}` : `images/${targetPosix}`;
        }

        let importPath = path.posix.relative(importerDir, targetPosix);
        if (!importPath.startsWith('.')) importPath = `./${importPath}`;
        // Ensure we read from the correct path for images
        if (importPath.startsWith('./')) {
          importPath = importPath.replace(/^\.\/+/, '../');
        } else {
          importPath = `../${importPath}`;
        }

        // Create a stable identifier for the imported image
        const baseName = targetPosix.split('/').pop() || 'image';
        const withoutExt = baseName.replace(/\.[^.]+$/, '') || 'image';
        // Build a safe JS identifier: camel-case on -/_ and replace any remaining
        // invalid characters (including dots) with underscores
        let imageIdent = toComponentName(withoutExt).replace(/[^A-Za-z0-9_]/g, '_');
        if (/^\d/.test(imageIdent)) imageIdent = `_${imageIdent}`;
        imageIdent = `${imageIdent}Img`;

        // Register ESM import for the asset
        ctx.registerImport?.(imageIdent, importPath);

        // Build <Image src={ident} alt width height />
        const attrs: MdastNode[] = [];
        // src as expression
        attrs.push({
          type: 'mdxJsxAttribute',
          name: 'src',
          value: { type: 'mdxJsxAttributeValueExpression', value: imageIdent },
        } as MdastNode);
        // alt string
        const altText = typeof node.options?.alt === 'string' ? node.options.alt : '';
        if (altText) {
          attrs.push({ type: 'mdxJsxAttribute', name: 'alt', value: altText } as MdastNode);
        }

        const toNumericAttr = (name: string, v: any): MdastNode | null => {
          if (v === undefined || v === null || v === '') return null;
          const num = typeof v === 'number' ? v : parseFloat(String(v));
          if (!Number.isNaN(num)) {
            return {
              type: 'mdxJsxAttribute',
              name,
              value: { type: 'mdxJsxAttributeValueExpression', value: String(num) },
            } as MdastNode;
          }
          return { type: 'mdxJsxAttribute', name, value: String(v) } as MdastNode;
        };
        // width / height as numbers when possible
        const widthRaw = node.options?.width;
        const heightRaw = node.options?.height;
        const widthAttr = toNumericAttr('width', widthRaw);
        const heightAttr = toNumericAttr('height', heightRaw);
        if (widthAttr) attrs.push(widthAttr);
        if (heightAttr) attrs.push(heightAttr);

        return {
          type: 'mdxJsxFlowElement',
          name: 'Image',
          attributes: attrs,
          children: [],
        } as MdastNode;
      }
      // Handle literalinclude specially
      if (directiveName === 'literalinclude') {
        const pathText = Array.isArray(node.argument)
          ? node.argument.map((a: any) => a.value ?? '').join('')
          : String(node.argument || '');
        
        // Create a code block with a comment about the source
        const codeValue = `// Source: ${pathText.trim()}\n// TODO: Content from external file not available during conversion`;
        return {
          type: 'code',
          lang: node.options?.language ?? null,
          value: codeValue,
        };
      }
      // Handle include/sharedinclude by emitting a standalone MDX file and importing/using it
      if (directiveName === 'include' || directiveName === 'sharedinclude') {
        const pathText = Array.isArray(node.argument)
          ? node.argument.map((a: any) => a.value ?? '').join('')
          : String(node.argument || '');

        const toMdxIncludePath = (p: string): string => {
          const trimmed = p.trim();
          if (/\.(rst|txt)$/i.test(trimmed)) return trimmed.replace(/\.(rst|txt)$/i, '.mdx');
          if (!/\.mdx$/i.test(trimmed)) return `${trimmed}.mdx`;
          return trimmed;
        };

        const emittedPath = toMdxIncludePath(pathText);
        // Normalize to a relative path (no leading slash) so emitted files are placed under the output folder
        const emittedPathNormalized = emittedPath.replace(/^\/+/, '');

        // Unwrap an inner Extract directive if present; otherwise, use children as-is
        const originalChildren: SnootyNode[] = Array.isArray(node.children) ? node.children : [];
        let contentChildren: SnootyNode[] = originalChildren;
        if (
          originalChildren.length === 1 &&
          originalChildren[0] &&
          originalChildren[0].type === 'directive' &&
          String(originalChildren[0].name ?? '').toLowerCase() === 'extract'
        ) {
          contentChildren = Array.isArray(originalChildren[0].children) ? (originalChildren[0].children as SnootyNode[]) : [];
        }

        // Recursively convert the include's content so it can collect and inject its own imports.
        const nestedRoot: SnootyNode = {
          type: 'root',
          children: contentChildren,
        };
        const emittedMdast = snootyAstToMdast(nestedRoot, {
          onEmitMDXFile: ctx.emitMDXFile,
          // Set the current output path to the emitted include file (POSIX-style)
          currentOutfilePath: emittedPathNormalized.replace(/\\+/g, '/'),
        });
        ctx.emitMDXFile?.(emittedPathNormalized, emittedMdast);

        // Compute component name from the include filename (CamelCase without extension)
        const baseName = emittedPathNormalized.replace(/\\+/g, '/').split('/').pop() || '';
        const withoutExt = baseName.replace(/\.mdx$/i, '');
        // Generate a component name, replace any dots with underscores, and prefix with underscore if it starts with a number
        let componentName = toComponentName(withoutExt).replace(/\./g, '_');
        if (/^\d/.test(componentName)) {
          componentName = `_${componentName}`;
        }
        // Compute import path RELATIVE to the file that will import this include.
        // Use POSIX paths to ensure MDX import consistency across platforms.
        const importerPosix = (ctx.currentOutfilePath || 'index.mdx').replace(/\\+/g, '/');
        const importerDir = path.posix.dirname(importerPosix);
        const targetPosix = emittedPathNormalized.replace(/^\/*/, '').replace(/\\+/g, '/');
        let importPath = path.posix.relative(importerDir, targetPosix);
        if (!importPath.startsWith('.')) importPath = `./${importPath}`;
        // Register the import for injection at the top of the file
        ctx.registerImport?.(componentName, importPath);

        // Return the component usage instead of <Include>
        return {
          type: 'mdxJsxFlowElement',
          name: componentName,
          attributes: [],
          children: [],
        } as MdastNode;
      }
      
      // Generic fallback for any Snooty directive (block-level).
      const componentName = toComponentName(node.name ?? 'Directive');
      // Map directive options to JSX attributes.
      const attributes: MdastNode[] = [];
      if (node.options && typeof node.options === 'object') {
        for (const [key, value] of Object.entries(node.options)) {
          if (value === undefined) continue;
          // Strings can be written as-is, everything else becomes an
          // expression so that complex types survive serialisation.
          if (typeof value === 'string') {
            attributes.push({ type: 'mdxJsxAttribute', name: key, value });
          } else {
            attributes.push({
              type: 'mdxJsxAttribute',
              name: key,
              value: { type: 'mdxJsxAttributeValueExpression', value: JSON.stringify(value) },
            });
          }
        }
      }

      // Directive argument: for some directives we want it as an attribute (e.g. "only", "cond").
      let includeArgumentAsChild = true;
      if (node.argument && (directiveName === 'only' || directiveName === 'cond')) {
        // Convert the condition expression into an attribute instead of child text
        const exprText = Array.isArray(node.argument)
          ? node.argument.map((a: any) => a.value ?? '').join('')
          : String(node.argument);
        attributes.push({ type: 'mdxJsxAttribute', name: 'expr', value: exprText.trim() });
        includeArgumentAsChild = false;
      }

      // Collect children coming from the directive's argument and body.
      const children: MdastNode[] = [];
      if (includeArgumentAsChild) {
        if (Array.isArray(node.argument)) {
          children.push(...convertChildren(node.argument, sectionDepth, ctx));
        } else if (typeof node.argument === 'string') {
          children.push({ type: 'text', value: node.argument });
        }
      }
      children.push(...convertChildren(node.children ?? [], sectionDepth, ctx));

      // Filter out empty directive elements that don't contribute to the output
      const emptyDirectives = ['toctree', 'index', 'seealso'];
      if (emptyDirectives.includes(directiveName) && children.length === 0 && attributes.length === 0) {
        return null;
      }

      return {
        type: 'mdxJsxFlowElement',
        name: componentName,
        attributes,
        children,
      } as MdastNode;
    }

    case 'ref_role':
    case 'doc': {  // doc role is like ref_role
      // Cross-document / internal reference emitted as a link
      const url = node.url ?? node.refuri ?? node.target ?? '';
      if (!url) {
        return convertChildren(node.children ?? [], sectionDepth, ctx);
      }
      return {
        type: 'mdxJsxTextElement',
        name: 'Ref',
        attributes: [{ type: 'mdxJsxAttribute', name: 'url', value: url }],
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      } as MdastNode;
    }

    case 'role': {
      // Inline roles convert to inline JSX elements.
      const componentName = toComponentName(node.name ?? 'Role');
      const attributes: MdastNode[] = [];
      if (node.target) {
        attributes.push({ type: 'mdxJsxAttribute', name: 'target', value: node.target });
      }
      const children = convertChildren(node.children ?? [], sectionDepth, ctx);
      // If the role had a literal value but no children (e.g. :abbr:`abbr`)
      if (!children.length && node.value) {
        children.push({ type: 'text', value: node.value });
      }
      return {
        type: 'mdxJsxTextElement',
        name: componentName,
        attributes,
        children,
      } as MdastNode;
    }

    case 'superscript':
      return {
        type: 'mdxJsxTextElement',
        name: 'sup',
        attributes: [],
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      } as MdastNode;

    case 'subscript':
      return {
        type: 'mdxJsxTextElement',
        name: 'sub',
        attributes: [],
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      } as MdastNode;

    case 'definitionList': {
      const children = convertChildren(node.children ?? [], sectionDepth, ctx);
      return {
        type: 'mdxJsxFlowElement',
        name: 'DefinitionList',
        attributes: [],
        children,
      } as MdastNode;
    }

    case 'definitionListItem': {
      const termChildren = convertChildren(node.term ?? [], sectionDepth, ctx);
      const descChildren = convertChildren(node.children ?? [], sectionDepth, ctx);
      return {
        type: 'mdxJsxFlowElement',
        name: 'DefinitionListItem',
        attributes: [],
        children: [...termChildren, ...descChildren],
      } as MdastNode;
    }

    case 'line_block': {
      // Convert each line into a separate text line with <br/> between them
      const lines = (node.children ?? []).flatMap((ln, idx, arr) => {
        const converted = convertChildren([ln], sectionDepth, ctx);
        if (idx < arr.length - 1) {
          // add a hard line break
          converted.push({ type: 'break' });
        }
        return converted;
      });
      return { type: 'paragraph', children: lines } as MdastNode;
    }

    case 'line':
      return { type: 'text', value: node.value ?? '' } as MdastNode;

    case 'title_reference':
      return {
        type: 'emphasis',
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      } as MdastNode;

    case 'footnote': {
      const identifier = String(node.id ?? node.name ?? '');
      if (!identifier) {
        // Fallback to emitting content inline if id missing
        return convertChildren(node.children ?? [], sectionDepth, ctx);
      }
      return {
        type: 'footnoteDefinition',
        identifier,
        label: node.name ?? undefined,
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      } as MdastNode;
    }

    case 'footnote_reference': {
      const identifier = String(node.id ?? '');
      if (!identifier) return null;
      return {
        type: 'footnoteReference',
        identifier,
        label: node.refname ?? undefined,
      } as MdastNode;
    }

    case 'named_reference':
      // Named references are link reference definitions that we've already resolved elsewhere; omit.
      return null;

    case 'substitution_definition':
      // Substitution definitions are processed elsewhere, skip them here
      return null;

    case 'substitution_reference':
    case 'substitution': {  // parser sometimes uses 'substitution' instead
      const refname = node.refname || node.name || '';

      const subChildren = convertChildren(node.children ?? [], sectionDepth, ctx);
      const attributes: MdastNode[] = [];
      if (refname) {
        attributes.push({ type: 'mdxJsxAttribute', name: 'name', value: refname });
      }
      return {
        type: 'mdxJsxTextElement',
        name: 'SubstitutionReference',
        attributes,
        children: subChildren,
      } as MdastNode;
    }

    case 'directive_argument':
      // Simply collapse and process its children.
      return convertChildren(node.children ?? [], sectionDepth, ctx);

    case 'transition':
      return { type: 'thematicBreak' };

    case 'card-group': {
      // Convert card-group to a JSX component
      const attributes: MdastNode[] = [];
      if (node.options && typeof node.options === 'object') {
        for (const [key, value] of Object.entries(node.options)) {
          if (value === undefined) continue;
          if (typeof value === 'string') {
            attributes.push({ type: 'mdxJsxAttribute', name: key, value });
          } else {
            attributes.push({
              type: 'mdxJsxAttribute',
              name: key,
              value: { type: 'mdxJsxAttributeValueExpression', value: JSON.stringify(value) },
            });
          }
        }
      }
      return {
        type: 'mdxJsxFlowElement',
        name: 'CardGroup',
        attributes,
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      } as MdastNode;
    }

    case 'cta-banner': {
      // Convert CTA banner to a JSX component
      const attributes: MdastNode[] = [];
      if (node.options && typeof node.options === 'object') {
        for (const [key, value] of Object.entries(node.options)) {
          if (value === undefined) continue;
          if (typeof value === 'string') {
            attributes.push({ type: 'mdxJsxAttribute', name: key, value });
          } else {
            attributes.push({
              type: 'mdxJsxAttribute',
              name: key,
              value: { type: 'mdxJsxAttributeValueExpression', value: JSON.stringify(value) },
            });
          }
        }
      }
      return {
        type: 'mdxJsxFlowElement',
        name: 'CTABanner',
        attributes,
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      } as MdastNode;
    }

    case 'tabs': {
      // Convert tabs container to a JSX component
      return {
        type: 'mdxJsxFlowElement',
        name: 'Tabs',
        attributes: [],
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      } as MdastNode;
    }

    case 'only': {
      // Convert only directive to a JSX component with condition
      const condition = Array.isArray(node.argument)
        ? node.argument.map((a: any) => a.value ?? '').join('')
        : String(node.argument || '');
      return {
        type: 'mdxJsxFlowElement',
        name: 'Only',
        attributes: [{ type: 'mdxJsxAttribute', name: 'condition', value: condition.trim() }],
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      } as MdastNode;
    }

    case 'method-selector': {
      // Convert method selector to a JSX component
      return {
        type: 'mdxJsxFlowElement',
        name: 'MethodSelector',
        attributes: [],
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      } as MdastNode;
    }

    case 'target': {
      // Convert to one or more invisible anchor <span> elements
      const ids: string[] = [];
      if (typeof node.html_id === 'string') ids.push(node.html_id);
      if (Array.isArray(node.ids)) ids.push(...node.ids);
      if (ids.length === 0 && typeof node.name === 'string') ids.push(node.name);
      if (ids.length === 0) return null;
      return ids.map((id) => ({
        type: 'mdxJsxFlowElement',
        name: 'span',
        attributes: [{ type: 'mdxJsxAttribute', name: 'id', value: id }],
        children: [],
      })) as MdastNode[];
    }

    case 'inline_target':
    case 'target_identifier': {
      const ids: string[] = [];
      if (Array.isArray(node.ids)) ids.push(...node.ids);
      if (typeof node.html_id === 'string') ids.push(node.html_id);
      if (ids.length === 0) return null;
      return ids.map((id) => ({
        type: 'mdxJsxFlowElement',
        name: 'span',
        attributes: [{ type: 'mdxJsxAttribute', name: 'id', value: id }],
        children: [],
      })) as MdastNode[];
    }

    // Additional parser node types not in standard AST types
    case 'block_quote':
      return {
        type: 'blockquote',
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      };
    
    case 'literal_block': {
      let value = node.value ?? '';
      if (!value && Array.isArray(node.children)) {
        value = node.children.map((c: any) => c.value ?? '').join('');
      }
      return { type: 'code', lang: node.lang ?? node.language ?? null, value };
    }
    
    case 'bullet_list':
      return {
        type: 'list',
        ordered: false,
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      };
    
    case 'ordered_list':
      return {
        type: 'list',
        ordered: true,
        start: node.start ?? 1,
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      };
    
    case 'list_item':
      return {
        type: 'listItem',
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      };
    
    case 'title': {
      // Title nodes (used in sections) convert to headings
      return {
        type: 'heading',
        depth: node.depth ?? Math.min(sectionDepth, 6),
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      };
    }

    case 'admonition': {
      // Admonitions are a type of directive
      const admonitionName = String(node.name ?? node.admonition_type ?? 'note');
      const componentName = toComponentName(admonitionName);
      return {
        type: 'mdxJsxFlowElement',
        name: componentName,
        attributes: [],
        children: convertChildren(node.children ?? [], sectionDepth, ctx),
      } as MdastNode;
    }

    // Parser-specific node types that we skip
    case 'comment':
    case 'comment_block':
      return null;

    default:
      // Unknown node → keep children if any, else emit comment.
      if (node.children && node.children.length) {
        return convertChildren(node.children, sectionDepth, ctx);
      }
      return { type: 'html', value: `<!-- unsupported: ${node.type} -->` };
  }
}

interface SnootyAstToMdastOptions {
  onEmitMDXFile?: ConversionContext['emitMDXFile'];
  currentOutfilePath?: string
}

export function snootyAstToMdast(root: SnootyNode, options?: SnootyAstToMdastOptions): MdastNode {
  const metaFromDirectives: Record<string, any> = {};
  const contentChildren: MdastNode[] = [];
  const includedImports = new Map<string, string>();

  const ctx: ConversionContext = {
    registerImport: (componentName: string, importPath: string) => {
      if (!componentName || !importPath) return;
      includedImports.set(componentName, importPath);
    },
    emitMDXFile: options?.onEmitMDXFile,
    currentOutfilePath: options?.currentOutfilePath,
  };

  (root.children ?? []).forEach((child: SnootyNode) => {
    // Collect <meta> directives: they appear as directive nodes with name 'meta'.
    if (child.type === 'directive' && String(child.name).toLowerCase() === 'meta' && child.options) {
      Object.assign(metaFromDirectives, child.options);
      return; // do not include this node in output
    }
    const converted = convertNode(child, 1, ctx);
    if (Array.isArray(converted)) contentChildren.push(...converted);
    else if (converted) contentChildren.push(converted);
  });

  // Merge page-level options that sit on the root node itself.
  const pageOptions = (root as any).options ?? {};
  const frontmatterObj = { ...pageOptions, ...metaFromDirectives };

  // Compose final children array with optional frontmatter
  const children: MdastNode[] = [];
  if (Object.keys(frontmatterObj).length) {
    children.push({ type: 'yaml', value: objectToYaml(frontmatterObj) } as MdastNode);
  }
  // Inject collected imports as ESM blocks right after frontmatter (or at top if no frontmatter)
  if (includedImports.size > 0) {
    const entries = Array.from(includedImports.entries());
    const nonImage: Array<[string, string]> = [];
    const image: Array<[string, string]> = [];

    const isImagePath = (p: string): boolean => /\.(png|jpe?g|gif|svg|webp|avif)$/i.test(p);
    for (const e of entries) {
      (isImagePath(e[1]) ? image : nonImage).push(e);
    }
    // ensure images are imported last (nice formatting)
    const ordered = [...nonImage, ...image];
    const importLines: string[] = ordered.map(([componentName, importPath]) => `import ${componentName} from '${importPath}';`);

    children.push({
      type: 'mdxjsEsm',
      value: importLines.join('\n'),
    } as MdastNode);
  }
  children.push(...contentChildren);

  return {
    type: 'root',
    children: wrapInlineRuns(children),
  } as MdastNode;
}

/** Ensure that any stray inline nodes at the root (or other flow-level
    parents) are wrapped in paragraphs so that the final mdast is valid and
    spaced correctly when stringified. */
const wrapInlineRuns = (nodes: MdastNode[]): MdastNode[] => {
  const result: MdastNode[] = [];
  let inlineRun: MdastNode[] = [];
  const isInline = (n: MdastNode) => {
    return (
      n.type === 'text' ||
      n.type === 'emphasis' ||
      n.type === 'strong' ||
      n.type === 'inlineCode' ||
      n.type === 'break' ||
      n.type === 'mdxJsxTextElement' ||
      n.type === 'sub' ||
      n.type === 'sup' ||
      n.type === 'link' ||
      n.type === 'footnoteReference'
    );
  };
  const flushInlineRun = () => {
    if (inlineRun.length) {
      result.push({ type: 'paragraph', children: inlineRun } as MdastNode);
      inlineRun = [];
    }
  };
  for (const node of nodes) {
    if (isInline(node)) {
      inlineRun.push(node);
    } else {
      flushInlineRun();
      // Recursively process children that are arrays (e.g., list, listItem, etc.)
      if (Array.isArray((node as any).children)) {
        (node as any).children = wrapInlineRuns((node as any).children as MdastNode[]);
      }
      result.push(node);
    }
  }
  flushInlineRun();
  return result;
};

/** Convert a Snooty (directive or role) name like "io-code-block" or "chapters" to
a React-friendly component name such as "IoCodeBlock" or "Chapters" */
const toComponentName = (name: string): string => {
  return String(name)
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/* Decide when a string needs to be quoted. */
const needsQuotes = (str: string): boolean => {
  return /[^A-Za-z0-9_\-.]/.test(str) || str !== str.trim();
};

/** Count the number of leading spaces in a string. */
const countLeadingSpaces = (s: string): number => {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) === 32) i++;
  return i;
};

/** Helper to produce YAML front-matter from a plain JavaScript object.
 * Recursively serialises nested objects and arrays while keeping the output
 * human-readable. This intentionally avoids external dependencies. */
const objectToYaml = (obj: Record<string, any>): string => {
  /* Recursively serialise a value, returning an array of YAML lines. */
  const stringify = (value: any, indent: number): string[] => {
    const pad = ' '.repeat(indent);

    // Null / undefined – omit entirely
    if (value === null || value === undefined) return [];

    // Primitive scalars
    if (typeof value === 'string') {
      return [needsQuotes(value) ? JSON.stringify(value) : value];
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return [String(value)];
    }

    // Arrays
    if (Array.isArray(value)) {
      if (value.length === 0) return ['[]'];
      const lines: string[] = [];
      value.forEach((item) => {
        const itemLines = stringify(item, indent + 2);
        if (itemLines.length === 0) return;

        // Primitive element – keep on the same line as the dash
        if (itemLines.length === 1 && !itemLines[0].startsWith(' ')) {
          lines.push(`${pad}- ${itemLines[0]}`);
          return;
        }

        // Complex element (object / array)
        const base = countLeadingSpaces(itemLines[0]);
        // First line content after the dash
        lines.push(`${pad}- ${itemLines[0].slice(base)}`);
        // Preserve relative indentation for subsequent lines
        for (let i = 1; i < itemLines.length; i++) {
          const lead = countLeadingSpaces(itemLines[i]);
          const rel = Math.max(0, lead - base);
          lines.push(`${pad}  ${' '.repeat(rel)}${itemLines[i].slice(lead)}`);
        }
      });
      return lines;
    }

    // Objects
    if (typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length === 0) return ['{}'];
      const lines: string[] = [];
      entries.forEach(([k, v]) => {
        const childLines = stringify(v, indent + 2);
        if (childLines.length === 0) return;
        const keyLine = `${pad}${k}:`;
        if (childLines.length === 1 && !childLines[0].startsWith(' ')) {
          // Primitive value can stay inline
          lines.push(`${keyLine} ${childLines[0]}`);
        } else {
          lines.push(keyLine);
          // Preserve the child's relative indentation beneath this key
          const base = (childLines.length > 0) ? (childLines[0].match(/^ */)?.[0].length ?? 0) : 0;
          childLines.forEach((cl) => {
            const lead = cl.match(/^ */)?.[0].length ?? 0;
            const rel = Math.max(0, lead - base);
            lines.push(`${pad}  ${' '.repeat(rel)}${cl.slice(lead)}`);
          });
        }
      });
      return lines;
    }

    // Fallback – JSON serialise
    return [JSON.stringify(value)];
  };

  /* Top-level mapping – no indent. */
  const yamlLines: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    const valLines = stringify(val, 2);
    if (valLines.length === 0) continue;
    if (valLines.length === 1) {
      yamlLines.push(`${key}: ${valLines[0]}`);
    } else {
      yamlLines.push(`${key}:`);
      yamlLines.push(...valLines);
    }
  }
  return yamlLines.join('\n');
};

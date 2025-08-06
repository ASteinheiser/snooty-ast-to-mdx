import type { Node } from 'unist';

interface MdastNode extends Node {
  [key: string]: any;
}

// TODO: replace with ast.ts types
interface SnootyNode {
  type: string;
  children?: SnootyNode[];
  value?: string;
  // Snooty specific properties we care about
  refuri?: string;
  language?: string;
  start?: number;
  depth?: number;
  title?: string;
  [key: string]: any;
};

/** Convert a list of Snooty nodes to a list of mdast nodes */
function convertChildren(nodes: SnootyNode[], depth: number): MdastNode[] {
  return nodes
    .map((n) => convertNode(n, depth))
    .flat()
    .filter(Boolean) as MdastNode[];
}

/** Convert a single Snooty node to mdast. Certain nodes (e.g. `section`) expand
    into multiple mdast siblings, so the return type can be an array. */
function convertNode(node: SnootyNode, sectionDepth = 1): MdastNode | MdastNode[] | null {
  switch (node.type) {
    case 'text':
      return { type: 'text', value: node.value ?? '' };

    case 'paragraph':
      return {
        type: 'paragraph',
        children: convertChildren(node.children ?? [], sectionDepth),
      };

    case 'emphasis':
      return {
        type: 'emphasis',
        children: convertChildren(node.children ?? [], sectionDepth),
      };

    case 'strong':
      return {
        type: 'strong',
        children: convertChildren(node.children ?? [], sectionDepth),
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
        children: convertChildren(node.children ?? [], sectionDepth),
      };

    case 'enumerated_list':
    case 'ordered_list':
      return {
        type: 'list',
        ordered: true,
        start: node.start ?? 1,
        children: convertChildren(node.children ?? [], sectionDepth),
      };

    case 'list_item':
      return {
        type: 'listItem',
        children: convertChildren(node.children ?? [], sectionDepth),
      };

    // Parser-emitted generic list node (covers both ordered & unordered)
    case 'list': {
      const ordered = (typeof node.enumtype === 'string' ? node.enumtype === 'ordered' : !!node.ordered);
      const start = ordered ? (node.startat ?? node.start ?? 1) : undefined;
      const mdastList: MdastNode = {
        type: 'list',
        ordered,
        children: convertChildren(node.children ?? [], sectionDepth),
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
        children: convertChildren(node.children ?? [], sectionDepth),
      } as MdastNode;

    case 'field': {
      const attributes: MdastNode[] = [];
      if (node.name) attributes.push({ type: 'mdxJsxAttribute', name: 'name', value: String(node.name) });
      if (node.label) attributes.push({ type: 'mdxJsxAttribute', name: 'label', value: String(node.label) });
      return {
        type: 'mdxJsxFlowElement',
        name: 'Field',
        attributes,
        children: convertChildren(node.children ?? [], sectionDepth),
      } as MdastNode;
    }

    // Basic grid table support (fallback until list-table covers all use-cases)
    case 'table':
      return {
        type: 'mdxJsxFlowElement',
        name: 'Table',
        attributes: [],
        children: convertChildren(node.children ?? [], sectionDepth),
      } as MdastNode;

      const attributes: MdastNode[] = [];
      if (node.name) attributes.push({ type: 'mdxJsxAttribute', name: 'name', value: String(node.name) });
      if (node.label) attributes.push({ type: 'mdxJsxAttribute', name: 'label', value: String(node.label) });
      return {
        type: 'mdxJsxFlowElement',
        name: 'Field',
        attributes,
        children: convertChildren(node.children ?? [], sectionDepth),
      } as MdastNode;

    case 'reference':
      if (node.refuri) {
        return {
          type: 'link',
          url: node.refuri,
          children: convertChildren(node.children ?? [], sectionDepth),
        };
      }
      // fallthrough: treat as plain children if no URI
      return convertChildren(node.children ?? [], sectionDepth);

    case 'section': {
      // Snooty frontend AST uses a `heading` child, parser AST may use `title`.
      const titleNode = (node.children ?? []).find((c) => c.type === 'title' || c.type === 'heading');
      const rest = (node.children ?? []).filter((c) => c !== titleNode);
      const mdast: MdastNode[] = [];

      if (titleNode) {
        mdast.push({
          type: 'heading',
          depth: Math.min(sectionDepth, 6),
          children: convertChildren(titleNode.children ?? [], sectionDepth),
        });
      }

      rest.forEach((child) => {
        const converted = convertNode(child, sectionDepth + 1);
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
        children: convertChildren(node.children ?? [], sectionDepth),
      };

    case 'directive': {
      // Special-case <Meta> directives here: we collect them at root level.
      if (String(node.name).toLowerCase() === 'meta') {
        // This node will be handled separately – skip here.
        return null;
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
      const directiveName = String(node.name ?? '').toLowerCase();
      let includeArgumentAsChild = true;
      if (node.argument && (directiveName === 'only' || directiveName === 'cond')) {
        // Convert the condition expression into an attribute instead of child text
        const exprText = Array.isArray(node.argument)
          ? node.argument.map((a: any) => a.value ?? '').join('')
          : String(node.argument);
        attributes.push({ type: 'mdxJsxAttribute', name: 'expr', value: exprText.trim() });
        includeArgumentAsChild = false;
      } else if (node.argument && (directiveName === 'include' || directiveName === 'sharedinclude')) {
        // For include directives, the argument is the path to include
        const pathText = Array.isArray(node.argument)
          ? node.argument.map((a: any) => a.value ?? '').join('')
          : String(node.argument);
        attributes.push({ type: 'mdxJsxAttribute', name: 'href', value: pathText.trim() });
        includeArgumentAsChild = false;
      }

      // Collect children coming from the directive's argument and body.
      const children: MdastNode[] = [];
      if (includeArgumentAsChild) {
        if (Array.isArray(node.argument)) {
          children.push(...convertChildren(node.argument, sectionDepth));
        } else if (typeof node.argument === 'string') {
          children.push({ type: 'text', value: node.argument });
        }
      }
      children.push(...convertChildren(node.children ?? [], sectionDepth));

      return {
        type: 'mdxJsxFlowElement',
        name: componentName,
        attributes,
        children,
      } as MdastNode;
    }

    case 'ref_role': {
      // Cross-document / internal reference emitted as a link
      const url = node.url ?? node.refuri ?? '';
      if (!url) {
        return convertChildren(node.children ?? [], sectionDepth);
      }
      return {
        type: 'link',
        url,
        children: convertChildren(node.children ?? [], sectionDepth),
      } as MdastNode;
    }

    case 'role': {
      // Inline roles convert to inline JSX elements.
      const componentName = toComponentName(node.name ?? 'Role');
      const attributes: MdastNode[] = [];
      if (node.target) {
        attributes.push({ type: 'mdxJsxAttribute', name: 'target', value: node.target });
      }
      const children = convertChildren(node.children ?? [], sectionDepth);
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
        children: convertChildren(node.children ?? [], sectionDepth),
      } as MdastNode;

    case 'subscript':
      return {
        type: 'mdxJsxTextElement',
        name: 'sub',
        attributes: [],
        children: convertChildren(node.children ?? [], sectionDepth),
      } as MdastNode;

    case 'definitionList': {
      const children = convertChildren(node.children ?? [], sectionDepth);
      return {
        type: 'mdxJsxFlowElement',
        name: 'DefinitionList',
        attributes: [],
        children,
      } as MdastNode;
    }

    case 'definitionListItem': {
      const termChildren = convertChildren(node.term ?? [], sectionDepth);
      const descChildren = convertChildren(node.children ?? [], sectionDepth);
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
        const converted = convertChildren([ln], sectionDepth);
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
        children: convertChildren(node.children ?? [], sectionDepth),
      } as MdastNode;

    case 'footnote': {
      const identifier = String(node.id ?? node.name ?? '');
      if (!identifier) {
        // Fallback to emitting content inline if id missing
        return convertChildren(node.children ?? [], sectionDepth);
      }
      return {
        type: 'footnoteDefinition',
        identifier,
        label: node.name ?? undefined,
        children: convertChildren(node.children ?? [], sectionDepth),
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

    case 'substitution_reference': {
      // Inline placeholder that will get replaced during rendering
      const subChildren = convertChildren(node.children ?? [], sectionDepth);
      const attributes: MdastNode[] = [];
      if (node.refname) {
        attributes.push({ type: 'mdxJsxAttribute', name: 'name', value: node.refname });
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
      return convertChildren(node.children ?? [], sectionDepth);

    case 'transition':
      return { type: 'thematicBreak' };

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

    default:
      // Unknown node → keep children if any, else emit comment.
      if (node.children && node.children.length) {
        return convertChildren(node.children, sectionDepth);
      }
      return { type: 'html', value: `<!-- unsupported: ${node.type} -->` };
  }
}

export function snootyAstToMdast(root: SnootyNode): MdastNode {
  const metaFromDirectives: Record<string, any> = {};
  const contentChildren: MdastNode[] = [];

  (root.children ?? []).forEach((child) => {
    // Collect <meta> directives: they appear as directive nodes with name 'meta'.
    if (child.type === 'directive' && String(child.name).toLowerCase() === 'meta' && child.options) {
      Object.assign(metaFromDirectives, child.options);
      return; // do not include this node in output
    }
    const converted = convertNode(child, 1);
    if (Array.isArray(converted)) contentChildren.push(...converted);
    else if (converted) contentChildren.push(converted);
  });

  // Merge page-level options that sit on the root node itself.
  const pageOptions = (root as any).options ?? {};
  const frontmatterObj = { ...pageOptions, ...metaFromDirectives };

  const children: MdastNode[] = [];
  if (Object.keys(frontmatterObj).length) {
    children.push({ type: 'yaml', value: objectToYaml(frontmatterObj) } as MdastNode);
  }
  children.push(...contentChildren);

  return {
    type: 'root',
    children,
  } as MdastNode;
}

/** Convert a Snooty (directive or role) name like "io-code-block" or "chapters" to
a React-friendly component name such as "IoCodeBlock" or "Chapters" */
const toComponentName = (name: string): string => {
  return String(name)
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** Helper to produce YAML front-matter from a plain object */
const objectToYaml = (obj: Record<string, any>): string => {
  return Object.entries(obj)
    .map(([k, v]) => {
      if (v === null || v === undefined) return '';
      // String: quote only if it contains spaces or special chars
      if (typeof v === 'string') {
        return `${k}: ${/[^A-Za-z0-9_\-]/.test(v) ? JSON.stringify(v) : v}`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    })
    .filter(Boolean)
    .join('\n');
}

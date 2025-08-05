// @ts-nocheck
/**
 * Snooty AST → mdast converter (minimal baseline)
 * ------------------------------------------------
 * This module exports a `snootyToMdast` function that takes the MongoDB
 * Snooty AST (as produced by the parser) and returns an mdast tree that can be
 * further processed by remark / rehype or serialised as Markdown/MDX.
 *
 * Only the common, Markdown-friendly node types are handled at the moment:
 *   – root / section / title --> root + heading
 *   – paragraph, text
 *   – emphasis / strong
 *   – lists (ordered & unordered) and items
 *   – code blocks (`code` node) and inline code (`literal`)
 *   – links (`reference` with `refuri`)
 *   – thematic break (`transition`)
 * All other nodes fall back to an HTML comment so that information is not
 * silently lost during the migration.
 *
 * The implementation purposefully keeps the typing very loose for now to avoid
 * importing the (large) `ast.ts` file directly from the Snooty frontend. Once
 * the converter stabilises we can tighten the types.
 */

import type { Node } from 'unist';

type SnootyNode = {
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

type MdastNode = Node & { [key: string]: any };

// Convert a Snooty (directive or role) name like "io-code-block" or "chapters" to
// a React-friendly component name such as "IoCodeBlock" or "Chapters".
function toComponentName(name: string): string {
  return String(name)
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function convertChildren(nodes: SnootyNode[], depth: number): MdastNode[] {
  return nodes
    .map((n) => convertNode(n, depth))
    .flat()
    .filter(Boolean) as MdastNode[];
}

/**
 * Convert a single Snooty node to mdast. Certain nodes (e.g. `section`) expand
 * into multiple mdast siblings, so the return type can be an array.
 */
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

    case 'literal': // inline code in Snooty AST
      return { type: 'inlineCode', value: node.value ?? '' };

    case 'code': // literal_block is mapped to `code` in frontend AST
    case 'literal_block': {
      const value = node.value ?? '';
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

      // Collect children coming from the directive's argument and body.
      const children: MdastNode[] = [];
      if (Array.isArray(node.argument)) {
        children.push(...convertChildren(node.argument, sectionDepth));
      } else if (typeof node.argument === 'string') {
        children.push({ type: 'text', value: node.argument });
      }
      children.push(...convertChildren(node.children ?? [], sectionDepth));

      return {
        type: 'mdxJsxFlowElement',
        name: componentName,
        attributes,
        children,
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

    case 'directive_argument':
      // Simply collapse and process its children.
      return convertChildren(node.children ?? [], sectionDepth);

    case 'transition':
      return { type: 'thematicBreak' };

    case 'target':
    case 'target_identifier':
      // Skip references/anchors that do not contribute to visible content
      return null;

    default:
      // Unknown node → keep children if any, else emit comment.
      if (node.children && node.children.length) {
        return convertChildren(node.children, sectionDepth);
      }
      return { type: 'html', value: `<!-- unsupported: ${node.type} -->` };
  }
}

export function snootyToMdast(root: SnootyNode): MdastNode {
  return {
    type: 'root',
    children: convertChildren(root.children ?? [], 1),
  } as MdastNode;
}

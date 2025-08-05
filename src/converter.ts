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
      // first child is `title`
      const titleNode = (node.children ?? []).find((c) => c.type === 'title');
      const rest = (node.children ?? []).filter((c) => c.type !== 'title');
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
      return {
        type: 'heading',
        depth: Math.min(sectionDepth, 6),
        children: convertChildren(node.children ?? [], sectionDepth),
      };

    case 'transition':
      return { type: 'thematicBreak' };

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

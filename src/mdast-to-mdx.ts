// @ts-nocheck
/**
 * mdast → MDX serialiser
 * ----------------------
 * Given an mdast root node, returns a string of MDX. This is a very light
 * wrapper around `remark` using `remark-mdx` and the default `remark-stringify`
 * compiler.
 *
 * The function is asynchronous because unified processors can be async when
 * plugins perform I/O. In this minimal implementation it will resolve
 * immediately, but returning a Promise offers flexibility for future
 * extensions.
 */
import { remark } from 'remark';
import remarkMdx from 'remark-mdx';

/**
 * Convert an mdast tree to an MDX string.
 *
 * @param tree - The mdast root node to serialise
 * @returns MDX as a string
 */
export async function mdastToMdx(tree: any): Promise<string> {
  const processor = remark().use(remarkMdx);
  // `stringify` returns the compiled output (string).
  const output = processor.stringify(tree as any) as unknown as string;
  return typeof output === 'string' ? output : String(output);
}

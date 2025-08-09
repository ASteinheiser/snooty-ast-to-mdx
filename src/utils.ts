import path from 'node:path';

// Path helpers that preserve MDX-friendly forward slashes using path.posix
export const normalizeToPosix = (p: string): string => path.posix.normalize(p);

export const dirnamePosix = (p: string): string => path.posix.dirname(p);

export const relativeForMdx = (fromPosix: string, toPosix: string): string => {
  const rel = path.relative(fromPosix, toPosix);
  const norm = normalizeToPosix(rel);
  return norm;
};

export const stripTsExtension = (p: string): string => p.replace(/\.ts$/i, '');

// Component/name helpers
export const toComponentName = (name: string): string => {
  return String(name)
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
};

// YAML helpers used for frontmatter
const needsQuotes = (str: string): boolean => {
  return /[^A-Za-z0-9_\-.]/.test(str) || str !== str.trim();
};

const countLeadingSpaces = (s: string): number => {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) === 32) i++;
  return i;
};

export const objectToYaml = (obj: Record<string, any>): string => {
  const stringify = (value: any, indent: number): string[] => {
    const pad = ' '.repeat(indent);

    if (value === null || value === undefined) return [];

    if (typeof value === 'string') {
      return [needsQuotes(value) ? JSON.stringify(value) : value];
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return [String(value)];
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return ['[]'];
      const lines: string[] = [];
      value.forEach((item) => {
        const itemLines = stringify(item, indent + 2);
        if (itemLines.length === 0) return;
        if (itemLines.length === 1 && !itemLines[0].startsWith(' ')) {
          lines.push(`${pad}- ${itemLines[0]}`);
          return;
        }
        const base = countLeadingSpaces(itemLines[0]);
        lines.push(`${pad}- ${itemLines[0].slice(base)}`);
        for (let i = 1; i < itemLines.length; i++) {
          const lead = countLeadingSpaces(itemLines[i]);
          const rel = Math.max(0, lead - base);
          lines.push(`${pad}  ${' '.repeat(rel)}${itemLines[i].slice(lead)}`);
        }
      });
      return lines;
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length === 0) return ['{}'];
      const lines: string[] = [];
      entries.forEach(([k, v]) => {
        const childLines = stringify(v, indent + 2);
        if (childLines.length === 0) return;
        const keyLine = `${pad}${k}:`;
        if (childLines.length === 1 && !childLines[0].startsWith(' ')) {
          lines.push(`${keyLine} ${childLines[0]}`);
        } else {
          lines.push(keyLine);
          const base = childLines.length > 0 ? countLeadingSpaces(childLines[0]) : 0;
          childLines.forEach((cl) => {
            const lead = countLeadingSpaces(cl);
            const rel = Math.max(0, lead - base);
            lines.push(`${pad}  ${' '.repeat(rel)}${cl.slice(lead)}`);
          });
        }
      });
      return lines;
    }

    return [JSON.stringify(value)];
  };

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

// References artifact helpers
export type ReferencesArtifact = {
  substitutions: Record<string, string>;
  refs: Record<string, { title: string; url: string }>;
};

export const buildReferencesTs = (artifact: ReferencesArtifact): string => {
  const substitutions = artifact.substitutions || {};
  const refs = artifact.refs || {};
  const esc = (s: string) => {
    const toString = (v: any) => (typeof v === 'string' ? v : String(v ?? ''));
    let str = toString(s);
    const MAX = 1000;
    if (str.length > MAX) str = str.slice(0, MAX) + '…';
    str = str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');
    return `'${str}'`;
  };

  const subsLines = Object.entries(substitutions)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${esc(v)},`)
    .join('\n');

  const refsLines = Object.entries(refs)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([url, { title }]) => `    ${esc(url)}: { title: ${esc(title)}, url: ${esc(url)} },`)
    .join('\n');

  return `export const substitutions = {\n${subsLines}\n} as const;\n` +
`export const refs = {\n${refsLines}\n} as const;\n` +
`const references = { substitutions, refs } as const;\nexport default references;\n`;
};

export const readExistingReferences = (filePath: string): ReferencesArtifact => {
  try {
    const fs = require('fs') as typeof import('fs');
    const text = fs.readFileSync(filePath, 'utf8');
    const result: ReferencesArtifact = { substitutions: {}, refs: {} };

    const decodeLiteral = (s: string): string => {
      return s
        .replace(/\\r/g, '\r')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\'/g, "'")
        .replace(/\\\"/g, '"')
        .replace(/\\\\/g, '\\');
    };

    const parseSubsBody = (body: string) => {
      const re = /(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1\s*:\s*(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\3\s*,?/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        const key = decodeLiteral(m[2]);
        const val = decodeLiteral(m[4]);
        result.substitutions[key] = val;
      }
    };

    const parseRefsBody = (body: string) => {
      const re = /(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1\s*:\s*\{\s*title:\s*(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\3\s*,\s*url:\s*(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\5\s*\}\s*,?/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        const urlKey = decodeLiteral(m[2]);
        const title = decodeLiteral(m[4]);
        const url = decodeLiteral(m[6]);
        result.refs[urlKey] = { title, url };
      }
    };

    const subsMatchNamed = text.match(/export\s+const\s+substitutions\s*=\s*\{([\s\S]*?)\}\s*as\s+const/);
    const subsMatchDefault = text.match(/substitutions\s*:\s*\{([\s\S]*?)\}\s*,/);
    const subsMatch = subsMatchNamed || subsMatchDefault;
    if (subsMatch) parseSubsBody(subsMatch[1]);

    const refsMatchNamed = text.match(/export\s+const\s+refs\s*=\s*\{([\s\S]*?)\}\s*as\s+const/);
    const refsMatchDefault = text.match(/refs\s*:\s*\{([\s\S]*?)\}\s*\n\s*\}/);
    const refsMatch = refsMatchNamed || refsMatchDefault;
    if (refsMatch) parseRefsBody(refsMatch[1]);

    return result;
  } catch {
    return { substitutions: {}, refs: {} };
  }
};

export const mergeReferences = (base: ReferencesArtifact, add: ReferencesArtifact): ReferencesArtifact => {
  const outSubs: Record<string, string> = { ...base.substitutions };
  for (const [k, v] of Object.entries(add.substitutions || {})) {
    outSubs[k] = v as string;
  }
  const outRefs: Record<string, { title: string; url: string }> = { ...base.refs };
  for (const [url, obj] of Object.entries(add.refs || {})) {
    outRefs[url] = obj as any;
  }
  return { substitutions: outSubs, refs: outRefs };
};

import { createHash } from 'node:crypto';
import { parse } from 'acorn';

export const pdpScript = 'scripts/scripts.js';
const kinds = ['import', 'autoblock', 'preview'];
const digest = (text) => createHash('sha256').update(text).digest('hex');
const marker = (kind, edge) => `edge-commerce:pdp:${kind}:${edge}`;
const firstStatement = (body) => body.find((node) => !node.directive);
const directiveEnd = (body, fallback) => {
  let end = fallback;
  for (const node of body) {
    if (!node.directive) break;
    end = node.end;
  }
  return end;
};

function nodesIn(node, nodes = []) {
  if (!node || typeof node !== 'object') return nodes;
  if (node.type) nodes.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) nodesIn(child, nodes);
    } else if (value && typeof value === 'object') nodesIn(value, nodes);
  }
  return nodes;
}

function inspect(source) {
  const comments = [];
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', onComment: comments });
  const nodes = nodesIn(ast);
  const top = ast.body.map((node) => node.declaration || node);
  const functions = {};
  for (const name of ['buildAutoBlocks', 'loadEager']) {
    const matches = nodes.filter(
      (node) => node.type === 'FunctionDeclaration' && node.id?.name === name,
    );
    if (matches.length !== 1 || !top.includes(matches[0])) {
      return { reason: `Expected one top-level ${name} function` };
    }
    const fn = matches[0];
    if (fn.generator || fn.params.length !== 1 || fn.params[0].type !== 'Identifier') {
      return { reason: `Unsupported ${name} parameters or generator` };
    }
    functions[name] = fn;
  }
  if (!functions.loadEager.async) return { reason: 'loadEager must be async' };
  return { ast, nodes, comments, functions };
}

function existingPDP({ nodes, comments }) {
  return (
    comments.some((comment) => comment.value.includes('edge-commerce:pdp')) ||
    nodes.some(
      (node) =>
        (node.type === 'Identifier' &&
          ['buildPDPBlock', 'loadPDPPreview', 'isProductPage'].includes(node.name)) ||
        (node.type === 'ImportDeclaration' &&
          /(?:^|[/_-])pdp(?:[./_-]|$)/i.test(node.source.value)) ||
        (node.type === 'Literal' &&
          typeof node.value === 'string' &&
          /meta\[.*name\s*=\s*["']?sku/i.test(node.value)) ||
        (node.type === 'CallExpression' &&
          node.callee?.name === 'buildBlock' &&
          node.arguments[0]?.value === 'pdp'),
    )
  );
}

function regionsIn(source, comments) {
  const markers = comments.filter((comment) => comment.value.includes('edge-commerce:pdp'));
  if (markers.length !== kinds.length * 2) throw Error('PDP marker comments were changed');
  const regions = {};
  for (const kind of kinds) {
    const start = markers.filter(
      (comment) => comment.type === 'Line' && comment.value === ` ${marker(kind, 'start')}`,
    );
    const end = markers.filter(
      (comment) => comment.type === 'Line' && comment.value === ` ${marker(kind, 'end')}`,
    );
    if (start.length !== 1 || end.length !== 1 || start[0].end >= end[0].start) {
      throw Error('PDP marker comments were changed');
    }
    let from = source.lastIndexOf('\n', start[0].start);
    if (from < 0 || !/^[\t ]*$/.test(source.slice(from + 1, start[0].start))) {
      throw Error('PDP region boundary was changed');
    }
    if (source[from - 1] === '\r') from -= 1;
    const newline = source.slice(end[0].end).match(/^\r?\n/);
    if (!newline) throw Error('PDP region boundary was changed');
    const to = end[0].end + newline[0].length;
    regions[kind] = { from, to, hash: digest(source.slice(from, to)) };
  }
  const spans = Object.values(regions).sort((a, b) => a.from - b.from);
  if (spans.some((span, index) => index && spans[index - 1].to > span.from)) {
    throw Error('PDP regions overlap');
  }
  return regions;
}

function stripRegions(source, regions) {
  let content = source;
  for (const { from, to } of Object.values(regions).sort((a, b) => b.from - a.from)) {
    content = content.slice(0, from) + content.slice(to);
  }
  return content;
}

function checkPlacement(info, regions) {
  const contains = (region, node) => node && node.start >= region.from && node.end <= region.to;
  if (
    !info.ast.body.some(
      (node) => node.type === 'ImportDeclaration' && contains(regions.import, node),
    )
  ) {
    throw Error('PDP import was moved');
  }
  for (const [kind, name] of [
    ['autoblock', 'buildAutoBlocks'],
    ['preview', 'loadEager'],
  ]) {
    if (!contains(regions[kind], firstStatement(info.functions[name].body.body))) {
      throw Error(`PDP hook must remain first in ${name}`);
    }
  }
}

/** Locate with the AST, splice only our text, and never execute customer JavaScript. */
export function integratePDP(source, recorded, { remove = false } = {}) {
  try {
    const info = inspect(source);
    if (info.reason) throw Error(info.reason);
    if (recorded) {
      if (remove && !existingPDP(info)) {
        return {
          action: 'unchanged',
          content: source,
          reason: 'managed PDP hooks were already removed manually',
        };
      }
      const regions = regionsIn(source, info.comments);
      for (const kind of kinds) {
        if (regions[kind].hash !== recorded[kind]) throw Error(`Edited PDP ${kind} region`);
      }
      checkPlacement(info, regions);
      const base = stripRegions(source, regions);
      const clean = inspect(base);
      if (clean.reason || existingPDP(clean))
        throw Error('PDP loader changed outside managed regions');
      // A renamed parameter would leave the inserted call using the old identifier.
      const call = firstStatement(info.functions.buildAutoBlocks.body.body)?.expression;
      if (call?.arguments?.[0]?.name !== info.functions.buildAutoBlocks.params[0].name) {
        throw Error('buildAutoBlocks parameter no longer matches the PDP hook');
      }
      return {
        action: remove ? 'update' : 'unchanged',
        content: remove ? base : source,
        regions: recorded,
        reason: 'managed PDP integration',
      };
    }
    if (existingPDP(info))
      throw Error('Existing PDP detection, imports or hooks need manual review');

    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const regionText = (kind, code, indent = '') =>
      `${newline}${indent}// ${marker(kind, 'start')}${newline}${indent}${code}${newline}${indent}// ${marker(kind, 'end')}${newline}`;
    const imports = info.ast.body.filter((node) => node.type === 'ImportDeclaration');
    const headerEnd = source.startsWith('#!')
      ? source.indexOf('\n') + 1
      : source.startsWith('\uFEFF')
        ? 1
        : 0;
    const insertions = [
      {
        at: imports.at(-1)?.end ?? directiveEnd(info.ast.body, headerEnd),
        text: regionText(
          'import',
          "import { buildPDPBlock, loadPDPPreview } from './commerce/pdp-page.js';",
        ),
      },
    ];
    for (const [kind, name, code] of [
      [
        'autoblock',
        'buildAutoBlocks',
        `buildPDPBlock(${info.functions.buildAutoBlocks.params[0].name});`,
      ],
      ['preview', 'loadEager', 'await loadPDPPreview();'],
    ]) {
      const fn = info.functions[name];
      const statement = firstStatement(fn.body.body);
      const lineStart = statement ? source.lastIndexOf('\n', statement.start) + 1 : 0;
      const prefix = statement ? source.slice(lineStart, statement.start) : '';
      const indent = prefix && /^[\t ]+$/.test(prefix) ? prefix : '  ';
      insertions.push({
        at: directiveEnd(fn.body.body, fn.body.start + 1),
        text: regionText(kind, code, indent),
      });
    }
    let content = source;
    for (const { at, text } of insertions.sort((a, b) => b.at - a.at)) {
      content = content.slice(0, at) + text + content.slice(at);
    }
    // Parse the result again so unsupported syntax never produces a partial patch.
    const updated = inspect(content);
    const regions = regionsIn(content, updated.comments);
    checkPlacement(updated, regions);
    return {
      action: 'update',
      content,
      regions: Object.fromEntries(kinds.map((kind) => [kind, regions[kind].hash])),
      reason: 'insert PDP import and loader hooks',
    };
  } catch (error) {
    // Do not echo parser errors: their text can contain customer source.
    const reason =
      error instanceof SyntaxError
        ? 'scripts.js could not be parsed as a JavaScript module'
        : error.message;
    return { action: recorded ? 'conflict' : 'manual', reason };
  }
}

import { CstUtils, EmptyFileSystem, GrammarAST, isLeafCstNode, type CstNode } from 'langium';
import { createGasServices } from './gas-module.js';

export type HighlightKind =
  | 'keyword'
  | 'builtin'
  | 'section'
  | 'track'
  | 'action'
  | 'string'
  | 'number'
  | 'punct'
  | 'comment';

export interface HighlightToken {
  readonly from: number;
  readonly to: number;
  readonly kind: HighlightKind;
}

export interface SymbolOccurrence {
  readonly from: number;
  readonly to: number;
  readonly kind: 'track' | 'section';
  readonly name: string;
  readonly role: 'declaration' | 'reference';
}

export interface HighlightResult {
  readonly tokens: readonly HighlightToken[];
  readonly symbols: readonly SymbolOccurrence[];
}

const ACTION_TYPES = new Set([
  'PlayCommand',
  'StopCommand',
  'TimbreCommand',
  'NotesCommand',
  'MotifCommand',
  'LevelCommand',
  'EffectReservedCommand',
  'ExtendReservedCommand',
  'PromptReservedCommand',
  'LyricsReservedCommand',
  'LyricsThemeReservedCommand'
]);

const BUILTIN_TYPES = new Set(['FlavorDeclaration', 'FlavorCommand']);

/**
 * Returns editor-oriented token and symbol ranges without exposing Langium,
 * CST nodes, or generated AST types. Error recovery keeps useful highlighting
 * available while a document is incomplete.
 */
export function highlightSource(source: string): HighlightResult {
  const parsed = getParser().parse(source);
  const root = parsed.value?.$cstNode;
  if (root === undefined) {
    return { tokens: [], symbols: [] };
  }
  return {
    tokens: extractTokens(source, root),
    symbols: extractSymbols(root)
  };
}

function classifyLeaf(node: CstNode): HighlightKind | undefined {
  if (!isLeafCstNode(node)) return undefined;
  const tokenName = node.tokenType.name;
  const astType = node.astNode?.$type ?? '';
  if (tokenName === 'STRING') return 'string';
  if (tokenName === 'INT' || tokenName === 'DECIMAL') return 'number';
  if (tokenName === 'ALDA') return 'builtin';
  if (tokenName === 'ID') {
    if (astType === 'SectionDeclaration' || astType === 'SectionCall') return 'section';
    if (astType === 'TrackDeclaration' || astType === 'TrackStatement') return 'track';
    return undefined;
  }
  if (!GrammarAST.isKeyword(node.grammarSource)) return undefined;
  if (/^[.:()/]+$/.test(node.text)) return 'punct';
  if (BUILTIN_TYPES.has(astType)) return 'builtin';
  if (ACTION_TYPES.has(astType)) return 'action';
  return 'keyword';
}

function extractTokens(
  source: string,
  root: Parameters<typeof CstUtils.flattenCst>[0]
): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  for (const leaf of CstUtils.flattenCst(root)) {
    const kind = classifyLeaf(leaf);
    if (kind !== undefined && isLeafCstNode(leaf) && leaf.end > leaf.offset) {
      tokens.push({ from: leaf.offset, to: leaf.end, kind });
    }
  }
  const stringRanges = tokens.filter((token) => token.kind === 'string');
  let lineStart = 0;
  for (let index = 0; index <= source.length; index++) {
    if (index !== source.length && source[index] !== '\n') continue;
    for (let offset = lineStart; offset < index; offset++) {
      if (source[offset] !== '#') continue;
      if (!stringRanges.some((range) => range.from <= offset && offset < range.to)) {
        tokens.push({ from: offset, to: index, kind: 'comment' });
        break;
      }
    }
    lineStart = index + 1;
  }
  return tokens.sort((left, right) => left.from - right.from || left.to - right.to);
}

function extractSymbols(root: Parameters<typeof CstUtils.flattenCst>[0]): SymbolOccurrence[] {
  const symbols: SymbolOccurrence[] = [];
  for (const leaf of CstUtils.flattenCst(root)) {
    if (!isLeafCstNode(leaf) || leaf.tokenType.name !== 'ID') continue;
    const astType = leaf.astNode?.$type ?? '';
    const item = symbolFor(astType);
    if (item !== undefined) {
      symbols.push({ from: leaf.offset, to: leaf.end, name: leaf.text, ...item });
    }
  }
  return symbols.sort((left, right) => left.from - right.from || left.to - right.to);
}

function symbolFor(astType: string): Pick<SymbolOccurrence, 'kind' | 'role'> | undefined {
  switch (astType) {
    case 'TrackDeclaration':
      return { kind: 'track', role: 'declaration' };
    case 'TrackStatement':
      return { kind: 'track', role: 'reference' };
    case 'SectionDeclaration':
      return { kind: 'section', role: 'declaration' };
    case 'SectionCall':
      return { kind: 'section', role: 'reference' };
    default:
      return undefined;
  }
}

let parser: ReturnType<typeof createGasServices>['Gas']['parser']['LangiumParser'] | undefined;

function getParser(): NonNullable<typeof parser> {
  parser ??= createGasServices(EmptyFileSystem).Gas.parser.LangiumParser;
  return parser;
}

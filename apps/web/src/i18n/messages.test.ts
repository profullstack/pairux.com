import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IntlMessageFormat } from 'intl-messageformat';
import { DEFAULT_LOCALE, LOCALES } from './locales';

const MESSAGES_DIR = path.resolve(__dirname, '../../messages');

interface Tree {
  [key: string]: string | Tree;
}

function load(locale: string): Tree {
  return JSON.parse(readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), 'utf8')) as Tree;
}

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const id = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(id, value);
    else for (const [k, v] of flatten(value, id)) out.set(k, v);
  }
  return out;
}

const en = flatten(load(DEFAULT_LOCALE));

type Ast = ReturnType<IntlMessageFormat['getAst']>;

/** Every argument name a message uses, including inside plural/select branches. */
function argNames(ast: Ast, out = new Set<string>()): Set<string> {
  for (const node of ast) {
    // 1-6: argument, number, date, time, select, plural (0 literal, 7 #, 8 tag)
    const type = node.type as number;
    if (type >= 1 && type <= 6 && 'value' in node && typeof node.value === 'string') {
      out.add(node.value);
    }
    if ('options' in node) {
      for (const option of Object.values(node.options)) argNames(option.value, out);
    }
    if ('children' in node) argNames(node.children, out);
  }
  return out;
}

describe('message catalogs', () => {
  it('has exactly one JSON file per supported locale', () => {
    const files = readdirSync(MESSAGES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
    expect(files).toEqual([...LOCALES].sort());
  });

  it.each(LOCALES.filter((l) => l !== DEFAULT_LOCALE))(
    '%s has exactly the same keys as en.json',
    (locale) => {
      const keys = [...flatten(load(locale)).keys()].sort();
      expect(keys).toEqual([...en.keys()].sort());
    }
  );

  it.each(LOCALES)('%s messages are valid ICU and keep every {placeholder}', (locale) => {
    const messages = flatten(load(locale));
    for (const [id, message] of messages) {
      let parsed: IntlMessageFormat;
      try {
        parsed = new IntlMessageFormat(message, locale);
      } catch (error) {
        throw new Error(`${locale}:${id} is not valid ICU: ${String(error)}`);
      }
      expect(parsed, `${locale}:${id}`).toBeDefined();
      const expected = argNames(new IntlMessageFormat(en.get(id) ?? '', 'en').getAst());
      const actual = argNames(parsed.getAst());
      for (const name of expected) {
        expect(actual.has(name), `${locale}:${id} is missing {${name}}`).toBe(true);
      }
    }
  });
});

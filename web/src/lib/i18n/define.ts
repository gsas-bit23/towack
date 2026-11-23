/** One entry per string: [English, Simplified Chinese]. A missing translation is a compile error by construction. */
export type Pair = readonly [en: string, zh: string];
export type MessageTable = Record<string, Pair>;

export function defineMessages<const T extends MessageTable>(table: T): T {
  return table;
}

import udhrData from './udhr.json';

export interface UdhrSection {
  id: string;
  number: number;
  title: string;
  shortTitle: string;
  group: string;
  text: string;
}

export const UDHR = udhrData;
export const SECTIONS: UdhrSection[] = udhrData.sections;

export const ARTICLE_TITLES: Record<string, string> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s.title])
);

export const ARTICLE_TEXT: Record<string, string> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s.text])
);

export const ARTICLE_GROUPS: Record<string, string[]> = {};
for (const s of SECTIONS) {
  if (!ARTICLE_GROUPS[s.group]) ARTICLE_GROUPS[s.group] = [];
  ARTICLE_GROUPS[s.group].push(s.id);
}

export const ALL_SECTIONS = SECTIONS.map((s) => s.id);

export function getSection(num: number): UdhrSection | undefined {
  return SECTIONS.find((s) => s.number === num);
}

import type { FisImportIssue } from '../types.ts';

const labels: Record<string,string> = {
  INFO_OFFICIALS_OVER_BASIS: 'Officials über Basis (informativ)',
  QUOTA_SINGLE_ROOMS_EXCEEDED: 'Zusätzliche Einzelzimmer (Entscheidungsbedarf siehe offene Entscheidungen)',
};

/** Display the existing warning categories; never infer workflow requirements. */
export function importHintCategories(issues: FisImportIssue[]) {
  const grouped = new Map<string,{code:string;label:string;count:number}>();
  for (const issue of issues) {
    const category = grouped.get(issue.code);
    if (category) category.count += 1;
    else grouped.set(issue.code,{code:issue.code,label:labels[issue.code] ?? issue.message,count:1});
  }
  return [...grouped.values()];
}

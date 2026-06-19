// Audience filter = a boolean tree. Internal nodes combine children with AND/OR;
// leaves are a single condition on a user attribute/behaviour. Kept deliberately
// permissive (admin-only input) and translated defensively into a Prisma where.

export type AudienceNode = AudienceGroup | AudienceCondition;

export interface AudienceGroup {
  op: 'and' | 'or';
  children: AudienceNode[];
}

export interface AudienceCondition {
  field: AudienceField;
  operator: string;
  value?: unknown;
}

export type AudienceField =
  | 'followsTeam' // value: string[] (teamIds), operator: any | none
  | 'role' // value: 'ADMIN' | 'USER', operator: eq | neq
  | 'isActive' // value: boolean, operator: eq
  | 'pushEnabled' // value: boolean, operator: eq
  | 'inPool' // value: boolean, operator: eq
  | 'hasPredicted' // value: boolean, operator: eq
  | 'timezone' // value: string[] , operator: in | notin
  | 'createdAt'; // value: ISO string, operator: before | after

/** What the wizard saves and the API stores in NotificationCampaign.filter. */
export interface AudienceSpec {
  all: boolean;
  filter: AudienceNode | null;
}

export function isGroup(node: AudienceNode): node is AudienceGroup {
  return (node as AudienceGroup).op === 'and' || (node as AudienceGroup).op === 'or';
}

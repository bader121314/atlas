// SCIM 2.0 provisioning payloads (ADR-055).
import { z } from 'zod';

// Identity providers send many optional attributes; unknown ones are kept
// out of the result but do not fail the request (ADR-055).
export const scimUserSchema = z.looseObject({
  userName: z.string().trim().toLowerCase().pipe(z.email()).max(320),
  externalId: z.string().trim().min(1).max(256).optional(),
  displayName: z.string().trim().min(1).max(100).optional(),
  name: z
    .looseObject({
      formatted: z.string().trim().max(100).optional(),
      givenName: z.string().trim().max(100).optional(),
      familyName: z.string().trim().max(100).optional(),
    })
    .optional(),
  active: z.boolean().default(true),
});
export type ScimUserInput = z.infer<typeof scimUserSchema>;

/** Entra ID sends booleans as "True"/"False" strings in PATCH values. */
export const scimBoolean = z.union([
  z.boolean(),
  z
    .string()
    .regex(/^(true|false)$/i)
    .transform((v) => v.toLowerCase() === 'true'),
]);

export const scimPatchSchema = z.looseObject({
  Operations: z
    .array(
      z.looseObject({
        op: z
          .string()
          .transform((v) => v.toLowerCase())
          .pipe(z.enum(['add', 'replace', 'remove'])),
        path: z.string().max(200).optional(),
        value: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const scimListQuerySchema = z.looseObject({
  filter: z.string().max(400).optional(),
  startIndex: z.coerce.number().int().min(1).default(1),
  count: z.coerce.number().int().min(0).max(100).default(100),
});

/** The filters identity providers use to find a person before creating them. */
export function parseFilter(
  filter: string | undefined,
): { attribute: 'userName' | 'externalId'; value: string } | null | undefined {
  if (filter === undefined) return null;
  const match =
    /^\s*(userName|externalId)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  if (!match?.[1] || match[2] === undefined) return undefined;
  return {
    attribute:
      match[1].toLowerCase() === 'username' ? 'userName' : 'externalId',
    value: match[2].replace(/\\(.)/g, '$1'),
  };
}

export const AUDIT_REASON_HEADER = "X-WebLens-Audit-Reason";
export const MAX_AUDIT_REASON_LENGTH = 500;

/** Header values stay ASCII so Chinese operation reasons work in every browser transport. */
export function auditReasonHeaders(reason: string): Record<string, string> {
  return {
    [AUDIT_REASON_HEADER]: encodeURIComponent(reason.trim()),
  };
}

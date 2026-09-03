import type { AccessRole, AuthEnvelope, ScopeCapability } from "../api";

export function scopeAccessRole(auth: AuthEnvelope | null | undefined, scopeId: string | null): AccessRole | "admin" | null {
  if (!auth || !scopeId) return null;
  if (auth.user.role === "admin") return "admin";
  return auth.scopes.find((scope) => scope.id === scopeId)?.accessRole ?? null;
}

export function canInScope(
  auth: AuthEnvelope | null | undefined,
  scopeId: string | null,
  capability: ScopeCapability,
): boolean {
  if (!auth || !scopeId) return false;
  if (auth.user.role === "admin") return true;
  const scope = auth.scopes.find((item) => item.id === scopeId);
  if (!scope) return false;
  if (scope.capabilities) return scope.capabilities.includes(capability);
  if (scope.accessRole === "operator") return true;
  return capability === "resource.read" || capability === "pod.logs" || capability === "file.read";
}

export function scopeRoleLabel(role: ReturnType<typeof scopeAccessRole>): string {
  if (role === "admin") return "管理员";
  if (role === "operator") return "读写";
  if (role === "viewer") return "只读";
  return "未授权";
}

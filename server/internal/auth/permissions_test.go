package auth

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func TestPermissionsV2CombinesGroupAndDirectGrantsByHighestRole(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)
	if err := store.BootstrapAdmin(ctx, "AdminPass123"); err != nil {
		t.Fatalf("BootstrapAdmin: %v", err)
	}
	user, err := store.CreateNormalUser(ctx, "viewer01")
	if err != nil {
		t.Fatalf("CreateNormalUser: %v", err)
	}
	if _, err := store.UpsertCombo(ctx, "cluster-a", "default", "Default"); err != nil {
		t.Fatalf("UpsertCombo default: %v", err)
	}
	if _, err := store.UpsertCombo(ctx, "cluster-a", "staging", "Staging"); err != nil {
		t.Fatalf("UpsertCombo staging: %v", err)
	}
	defaultID := ComboID("cluster-a", "default")
	stagingID := ComboID("cluster-a", "staging")
	group, err := store.CreateScopeGroup(ctx, "应用平台", "平台团队作用域")
	if err != nil {
		t.Fatalf("CreateScopeGroup: %v", err)
	}
	if err := store.SetScopeGroupScopeIDs(ctx, group.ID, []string{defaultID, stagingID}); err != nil {
		t.Fatalf("SetScopeGroupScopeIDs: %v", err)
	}
	if err := store.SetUserGrants(ctx, user.ID, UserGrants{
		GroupGrants: []GroupGrant{{GroupID: group.ID, Role: AccessRoleViewer}},
		ScopeGrants: []ScopeGrant{{ScopeID: defaultID, Role: AccessRoleOperator}},
	}); err != nil {
		t.Fatalf("SetUserGrants: %v", err)
	}

	scopes, err := store.ListAuthorizedScopesForUser(ctx, user)
	if err != nil {
		t.Fatalf("ListAuthorizedScopesForUser: %v", err)
	}
	if len(scopes) != 2 {
		t.Fatalf("authorized scope count = %d, want 2", len(scopes))
	}
	roles := map[string]AccessRole{}
	for _, scope := range scopes {
		roles[scope.ID] = scope.AccessRole
		if scope.Group == nil || scope.Group.ID != group.ID {
			t.Fatalf("scope %s missing group summary: %#v", scope.ID, scope.Group)
		}
	}
	if roles[defaultID] != AccessRoleOperator {
		t.Fatalf("default role = %q, want operator", roles[defaultID])
	}
	if roles[stagingID] != AccessRoleViewer {
		t.Fatalf("staging role = %q, want viewer", roles[stagingID])
	}

	allowed, err := store.UserHasCapability(ctx, user, "cluster-a", "staging", CapabilityResourceRead)
	if err != nil || !allowed {
		t.Fatalf("viewer resource.read = %v, %v; want true, nil", allowed, err)
	}
	allowed, err = store.UserHasCapability(ctx, user, "cluster-a", "staging", CapabilityPodExec)
	if err != nil {
		t.Fatalf("viewer pod.exec: %v", err)
	}
	if allowed {
		t.Fatal("viewer unexpectedly received pod.exec")
	}
	allowed, err = store.UserHasCapability(ctx, user, "cluster-a", "default", CapabilityPodExec)
	if err != nil || !allowed {
		t.Fatalf("operator pod.exec = %v, %v; want true, nil", allowed, err)
	}
}

func TestScopeBelongsToAtMostOneGroupAndNonEmptyGroupCannotBeDeleted(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)
	if _, err := store.UpsertCombo(ctx, "cluster-a", "default", ""); err != nil {
		t.Fatalf("UpsertCombo: %v", err)
	}
	scopeID := ComboID("cluster-a", "default")
	first, err := store.CreateScopeGroup(ctx, "一组", "")
	if err != nil {
		t.Fatalf("CreateScopeGroup first: %v", err)
	}
	second, err := store.CreateScopeGroup(ctx, "二组", "")
	if err != nil {
		t.Fatalf("CreateScopeGroup second: %v", err)
	}
	if err := store.SetScopeGroupScopeIDs(ctx, first.ID, []string{scopeID}); err != nil {
		t.Fatalf("assign first group: %v", err)
	}
	if err := store.SetScopeGroupScopeIDs(ctx, second.ID, []string{scopeID}); err == nil {
		t.Fatal("same scope was accepted by a second group")
	}
	if err := store.DeleteScopeGroup(ctx, first.ID); err == nil {
		t.Fatal("non-empty group was deleted")
	}
	if err := store.SetScopeGroupScopeIDs(ctx, first.ID, nil); err != nil {
		t.Fatalf("clear first group: %v", err)
	}
	if err := store.DeleteScopeGroup(ctx, first.ID); err != nil {
		t.Fatalf("delete empty group: %v", err)
	}
}

func TestPermissionsV2MigratesLegacyScopeGrantsAsOperator(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	legacySchema := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL,
			disabled INTEGER NOT NULL DEFAULT 0,
			must_change_password INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE cluster_combos (
			id TEXT PRIMARY KEY,
			cluster_id TEXT NOT NULL,
			namespace TEXT NOT NULL,
			alias TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE(cluster_id, namespace)
		)`,
		`CREATE TABLE user_scope_grants (
			user_id INTEGER NOT NULL,
			combo_id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY(user_id, combo_id)
		)`,
		`INSERT INTO users(id, username, password_hash, role, created_at, updated_at)
		  VALUES(1, 'legacy01', 'unused', 'user', 100, 100)`,
		`INSERT INTO cluster_combos(id, cluster_id, namespace, alias, created_at, updated_at)
		  VALUES('cluster-a::default', 'cluster-a', 'default', '', 100, 100)`,
		`INSERT INTO user_scope_grants(user_id, combo_id, created_at)
		  VALUES(1, 'cluster-a::default', 123)`,
	}
	for _, stmt := range legacySchema {
		if _, err := db.Exec(stmt); err != nil {
			_ = db.Close()
			t.Fatalf("legacy schema statement: %v", err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close legacy db: %v", err)
	}

	store, err := Open(path)
	if err != nil {
		t.Fatalf("Open migrated store: %v", err)
	}
	defer store.Close()
	var role string
	var updatedAt int64
	if err := store.db.QueryRow(
		`SELECT access_role, updated_at FROM user_scope_grants WHERE user_id = 1 AND combo_id = 'cluster-a::default'`,
	).Scan(&role, &updatedAt); err != nil {
		t.Fatalf("read migrated grant: %v", err)
	}
	if role != string(AccessRoleOperator) {
		t.Fatalf("migrated role = %q, want operator", role)
	}
	if updatedAt != 123 {
		t.Fatalf("migrated updated_at = %d, want 123", updatedAt)
	}
}

func TestAuditLogFilters(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)
	userID := int64(7)
	for _, record := range []AuditRecord{
		{UserID: &userID, Username: "dev01", Action: "resource.write", Result: "success", StatusCode: 200, OperationLog: "发布新配置"},
		{UserID: &userID, Username: "dev01", Action: "pod.exec", Result: "denied", StatusCode: 403},
	} {
		if err := store.RecordAudit(ctx, record); err != nil {
			t.Fatalf("RecordAudit: %v", err)
		}
	}
	items, err := store.ListAuditLogs(ctx, AuditFilter{Action: "pod.exec", Result: "denied", Limit: 10})
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	if len(items) != 1 || items[0].StatusCode != 403 || items[0].Username != "dev01" {
		t.Fatalf("filtered audit items = %#v", items)
	}
	writeItems, err := store.ListAuditLogs(ctx, AuditFilter{Action: "resource.write", Result: "success", Limit: 10})
	if err != nil {
		t.Fatalf("ListAuditLogs resource.write: %v", err)
	}
	if len(writeItems) != 1 || writeItems[0].OperationLog != "发布新配置" {
		t.Fatalf("operation log items = %#v", writeItems)
	}
}

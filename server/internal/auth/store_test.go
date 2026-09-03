package auth

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "weblens.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestPasswordHashCannotBeUsedAsPassword(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)

	if err := store.BootstrapAdmin(ctx, "AdminPass123"); err != nil {
		t.Fatalf("BootstrapAdmin: %v", err)
	}
	admin, err := store.UserByUsername(ctx, "admin")
	if err != nil {
		t.Fatalf("UserByUsername: %v", err)
	}
	if admin.PasswordHash == "AdminPass123" {
		t.Fatal("password was stored in plaintext")
	}
	if !CheckPassword(admin.PasswordHash, "AdminPass123") {
		t.Fatal("stored hash does not verify original password")
	}
	if CheckPassword(admin.PasswordHash, admin.PasswordHash) {
		t.Fatal("stored hash should not verify as a usable login password")
	}
	if _, err := store.Authenticate(ctx, "admin", admin.PasswordHash); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("Authenticate with password hash err = %v, want ErrInvalidCredentials", err)
	}
	if _, err := store.Authenticate(ctx, "admin", "AdminPass123"); err != nil {
		t.Fatalf("Authenticate with plaintext password: %v", err)
	}
}

func TestDefaultPasswordRequiresChangeAndRejectsDefaultReuse(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)
	root := bootstrapRoot(t, store)
	user, temporaryPassword, err := store.CreateUser(ctx, root, "dev01", RoleUser)
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if temporaryPassword == "" || temporaryPassword == LegacyDefaultUserPassword {
		t.Fatalf("temporary password = %q, want random non-default password", temporaryPassword)
	}
	loggedIn, err := store.Authenticate(ctx, "dev01", temporaryPassword)
	if err != nil {
		t.Fatalf("Authenticate temporary password: %v", err)
	}
	if !loggedIn.MustChangePassword {
		t.Fatal("new normal user must change default password")
	}
	if err := store.ChangePassword(ctx, user.ID, "", LegacyDefaultUserPassword, ""); err == nil {
		t.Fatal("ChangePassword accepted the default password as the new password")
	}
	if err := store.ChangePassword(ctx, user.ID, "", "UserPass123", ""); err != nil {
		t.Fatalf("ChangePassword without old password during forced change: %v", err)
	}
	updated, err := store.UserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("UserByID: %v", err)
	}
	if updated.MustChangePassword {
		t.Fatal("must_change_password was not cleared after password update")
	}
	if err := store.ChangePassword(ctx, user.ID, "", "UserPass124", ""); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("ChangePassword without old password after forced change err = %v, want ErrInvalidCredentials", err)
	}
	if err := store.ChangePassword(ctx, user.ID, "UserPass123", "UserPass124", ""); err != nil {
		t.Fatalf("ChangePassword with current password after forced change: %v", err)
	}
}

func TestDisableAndResetInvalidateSessions(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)
	root := bootstrapRoot(t, store)
	user, _, err := store.CreateUser(ctx, root, "dev01", RoleUser)
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	token, tokenHash, err := NewSessionToken()
	if err != nil {
		t.Fatalf("NewSessionToken: %v", err)
	}
	if token == "" || tokenHash == "" {
		t.Fatal("empty session token")
	}
	if err := store.CreateSession(ctx, user.ID, tokenHash, time.Now().Add(IdleTimeout)); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if _, _, err := store.ValidateSession(ctx, tokenHash, time.Now()); err != nil {
		t.Fatalf("ValidateSession before disable: %v", err)
	}
	if err := store.SetUserDisabled(ctx, root, user.ID, true); err != nil {
		t.Fatalf("SetUserDisabled: %v", err)
	}
	if _, _, err := store.ValidateSession(ctx, tokenHash, time.Now()); err == nil {
		t.Fatal("disabled user session stayed valid")
	}

	if err := store.SetUserDisabled(ctx, root, user.ID, false); err != nil {
		t.Fatalf("SetUserDisabled enable: %v", err)
	}
	_, tokenHash, err = NewSessionToken()
	if err != nil {
		t.Fatalf("NewSessionToken: %v", err)
	}
	if err := store.CreateSession(ctx, user.ID, tokenHash, time.Now().Add(IdleTimeout)); err != nil {
		t.Fatalf("CreateSession after enable: %v", err)
	}
	if _, err := store.ResetUserPassword(ctx, root, user.ID); err != nil {
		t.Fatalf("ResetUserPassword: %v", err)
	}
	if _, _, err := store.ValidateSession(ctx, tokenHash, time.Now()); err == nil {
		t.Fatal("reset password did not invalidate existing sessions")
	}
	updated, err := store.UserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("UserByID: %v", err)
	}
	if !updated.MustChangePassword {
		t.Fatal("reset password did not require password change")
	}
}

func TestUserScopeAuthorizationIsNamespaceExact(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)
	root := bootstrapRoot(t, store)
	user, _, err := store.CreateUser(ctx, root, "dev01", RoleUser)
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	combos, err := store.UpsertCombo(ctx, "cluster-a", "default", "")
	if err != nil {
		t.Fatalf("UpsertCombo: %v", err)
	}
	if len(combos) != 1 {
		t.Fatalf("combo count = %d, want 1", len(combos))
	}
	ok, err := store.UserHasScope(ctx, user, "cluster-a", "default")
	if err != nil {
		t.Fatalf("UserHasScope: %v", err)
	}
	if ok {
		t.Fatal("user had scope before grant")
	}
	if err := store.SetUserScopeIDs(ctx, user.ID, []string{combos[0].ID}); err != nil {
		t.Fatalf("SetUserScopeIDs: %v", err)
	}
	ok, err = store.UserHasScope(ctx, user, "cluster-a", "default")
	if err != nil || !ok {
		t.Fatalf("UserHasScope granted = %v, %v; want true, nil", ok, err)
	}
	ok, err = store.UserHasScope(ctx, user, "cluster-a", "kube-system")
	if err != nil {
		t.Fatalf("UserHasScope other namespace: %v", err)
	}
	if ok {
		t.Fatal("scope grant leaked to another namespace")
	}
	ok, err = store.UserHasScope(ctx, user, "cluster-b", "default")
	if err != nil {
		t.Fatalf("UserHasScope other cluster: %v", err)
	}
	if ok {
		t.Fatal("scope grant leaked to another cluster")
	}
}

func bootstrapRoot(t *testing.T, store *Store) User {
	t.Helper()
	ctx := context.Background()
	if err := store.BootstrapAdmin(ctx, "AdminPass123"); err != nil {
		t.Fatalf("BootstrapAdmin: %v", err)
	}
	root, err := store.UserByUsername(ctx, "admin")
	if err != nil {
		t.Fatalf("UserByUsername admin: %v", err)
	}
	if !root.IsRoot || root.Role != RoleAdmin {
		t.Fatalf("bootstrap user = %#v, want root admin", root.User)
	}
	return root.User
}

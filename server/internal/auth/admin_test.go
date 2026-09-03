package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestPlatformAdminManagementBoundaries(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)
	root := bootstrapRoot(t, store)
	platformAdmin, _, err := store.CreateUser(ctx, root, "platform01", RoleAdmin)
	if err != nil {
		t.Fatalf("CreateUser platform admin: %v", err)
	}
	normalUser, firstPassword, err := store.CreateUser(ctx, platformAdmin, "dev01", RoleUser)
	if err != nil {
		t.Fatalf("platform admin CreateUser: %v", err)
	}
	_, secondPassword, err := store.CreateUser(ctx, platformAdmin, "dev02", RoleUser)
	if err != nil {
		t.Fatalf("platform admin CreateUser second: %v", err)
	}
	if firstPassword == secondPassword {
		t.Fatal("two users received the same generated temporary password")
	}
	forgedActor := normalUser
	forgedActor.Role = RoleAdmin
	if _, _, err := store.CreateUser(ctx, forgedActor, "forged01", RoleAdmin); !errors.Is(err, ErrForbidden) {
		t.Fatalf("forged actor CreateUser err = %v, want ErrForbidden", err)
	}

	peerAdmin, _, err := store.CreateUser(ctx, platformAdmin, "platform02", RoleAdmin)
	if err != nil {
		t.Fatalf("platform admin CreateUser peer admin: %v", err)
	}
	if _, err := store.ResetUserPassword(ctx, platformAdmin, peerAdmin.ID); err != nil {
		t.Fatalf("platform admin reset peer admin: %v", err)
	}
	if err := store.SetUserDisabled(ctx, platformAdmin, peerAdmin.ID, true); err != nil {
		t.Fatalf("platform admin disable peer admin: %v", err)
	}
	if err := store.DeleteUser(ctx, platformAdmin, peerAdmin.ID); err != nil {
		t.Fatalf("platform admin delete peer admin: %v", err)
	}

	if err := store.SetUserDisabled(ctx, platformAdmin, root.ID, true); !errors.Is(err, ErrRootUserProtected) {
		t.Fatalf("disable root err = %v, want ErrRootUserProtected", err)
	}
	if _, err := store.ResetUserPassword(ctx, platformAdmin, root.ID); !errors.Is(err, ErrRootUserProtected) {
		t.Fatalf("reset root err = %v, want ErrRootUserProtected", err)
	}
	if err := store.DeleteUser(ctx, platformAdmin, root.ID); !errors.Is(err, ErrRootUserProtected) {
		t.Fatalf("delete root err = %v, want ErrRootUserProtected", err)
	}
	if err := store.SetUserDisabled(ctx, platformAdmin, platformAdmin.ID, true); !errors.Is(err, ErrSelfManagement) {
		t.Fatalf("disable self err = %v, want ErrSelfManagement", err)
	}
	if err := store.DeleteUser(ctx, platformAdmin, normalUser.ID); !errors.Is(err, ErrUserMustBeDisabled) {
		t.Fatalf("delete enabled user err = %v, want ErrUserMustBeDisabled", err)
	}
	if err := store.SetUserDisabled(ctx, platformAdmin, normalUser.ID, true); err != nil {
		t.Fatalf("disable normal user: %v", err)
	}
	if err := store.DeleteUser(ctx, platformAdmin, normalUser.ID); err != nil {
		t.Fatalf("delete disabled normal user: %v", err)
	}

	if _, err := store.db.ExecContext(ctx, "UPDATE users SET disabled = 1 WHERE id = ?", root.ID); err == nil {
		t.Fatal("database trigger allowed disabling root")
	}
	if _, err := store.db.ExecContext(ctx, "DELETE FROM users WHERE id = ?", root.ID); err == nil {
		t.Fatal("database trigger allowed deleting root")
	}
}

func TestResetRootPasswordInvalidatesSessionsAndRecordsAudit(t *testing.T) {
	ctx := context.Background()
	store := newTestStore(t)
	root := bootstrapRoot(t, store)
	_, tokenHash, err := NewSessionToken()
	if err != nil {
		t.Fatalf("NewSessionToken: %v", err)
	}
	if err := store.CreateSession(ctx, root.ID, tokenHash, time.Now().Add(IdleTimeout)); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	revoked, err := store.ResetRootPassword(ctx, "RecoveryPass123!")
	if err != nil {
		t.Fatalf("ResetRootPassword: %v", err)
	}
	if revoked != 1 {
		t.Fatalf("revoked sessions = %d, want 1", revoked)
	}
	if _, _, err := store.ValidateSession(ctx, tokenHash, time.Now()); err == nil {
		t.Fatal("root recovery left an existing session valid")
	}
	recovered, err := store.Authenticate(ctx, "admin", "RecoveryPass123!")
	if err != nil {
		t.Fatalf("Authenticate recovered root: %v", err)
	}
	if !recovered.IsRoot || !recovered.MustChangePassword {
		t.Fatalf("recovered root = %#v, want root with forced password change", recovered)
	}
	items, err := store.ListAuditLogs(ctx, AuditFilter{Action: "root.password.recovery", Limit: 10})
	if err != nil {
		t.Fatalf("ListAuditLogs: %v", err)
	}
	if len(items) != 1 || items[0].Username != "system:local-recovery" || items[0].ResourceName != "admin" {
		t.Fatalf("root recovery audit = %#v", items)
	}
}

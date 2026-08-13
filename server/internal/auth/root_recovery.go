package auth

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// ResetRootPassword is a local break-glass operation. It never accepts a user
// identifier so it cannot be redirected to a delegated administrator.
func (s *Store) ResetRootPassword(ctx context.Context, temporaryPassword string) (int, error) {
	if err := ValidateNewPassword("", temporaryPassword); err != nil {
		return 0, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var rootCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE is_root = 1`).Scan(&rootCount); err != nil {
		return 0, err
	}
	if rootCount != 1 {
		return 0, errors.New("认证数据库必须且只能包含一个根管理员 admin")
	}
	root, err := scanUserWithPassword(tx.QueryRowContext(
		ctx,
		`SELECT id, username, password_hash, role, is_root, disabled, must_change_password, created_at, updated_at
		 FROM users WHERE is_root = 1`,
	))
	if err != nil {
		return 0, err
	}
	if root.Username != "admin" || root.Role != RoleAdmin || root.Disabled {
		return 0, ErrRootUserProtected
	}
	if CheckPassword(root.PasswordHash, temporaryPassword) {
		return 0, errors.New("临时密码不能与当前 admin 密码相同")
	}
	hash, err := HashPassword(temporaryPassword)
	if err != nil {
		return 0, err
	}

	var revokedSessions int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions WHERE user_id = ?`, root.ID).Scan(&revokedSessions); err != nil {
		return 0, err
	}
	now := time.Now().UnixMilli()
	if _, err := tx.ExecContext(
		ctx,
		`UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?`,
		hash,
		now,
		root.ID,
	); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, root.ID); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO audit_logs(
			user_id, username, action, method, path, cluster_id, namespace,
			resource_kind, resource_name, result, status_code, operation_log, detail, created_at
		) VALUES(NULL, 'system:local-recovery', 'root.password.recovery', 'CLI',
			'local://reset-admin-password', '', '', 'platform-user', 'admin',
			'success', 0, '', ?, ?)`,
		fmt.Sprintf("origin=local-cli; sessionsRevoked=%d", revokedSessions),
		now,
	); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return revokedSessions, nil
}

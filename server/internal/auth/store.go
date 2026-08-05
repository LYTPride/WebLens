package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

const (
	DefaultDBPath       = "data/weblens.db"
	DefaultUserPassword = "WebLens@2026"
	IdleTimeout         = 20 * time.Minute
	IdleWarningBefore   = 30 * time.Second

	RoleAdmin = "admin"
	RoleUser  = "user"
)

var (
	ErrAlreadyInitialized = errors.New("weblens is already initialized")
	ErrNotInitialized     = errors.New("weblens is not initialized")
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrUserDisabled       = errors.New("user is disabled")
	ErrForbidden          = errors.New("forbidden")
	ErrPasswordRequired   = errors.New("password change required")
)

type User struct {
	ID                 int64  `json:"id"`
	Username           string `json:"username"`
	Role               string `json:"role"`
	Disabled           bool   `json:"disabled"`
	MustChangePassword bool   `json:"mustChangePassword"`
	CreatedAt          int64  `json:"createdAt"`
	UpdatedAt          int64  `json:"updatedAt"`
}

type UserWithPassword struct {
	User
	PasswordHash string
}

type AdminUserRow struct {
	User
	ScopeCount int `json:"scopeCount"`
}

type ClusterCombo struct {
	ID        string `json:"id"`
	ClusterID string `json:"clusterId"`
	Namespace string `json:"namespace"`
	Alias     string `json:"alias,omitempty"`
}

type Store struct {
	db *sql.DB
}

func DBPath() string {
	if v := strings.TrimSpace(os.Getenv("WEBLENS_DB_PATH")); v != "" {
		return v
	}
	return DefaultDBPath
}

func OpenDefault() (*Store, error) {
	return Open(DBPath())
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	s := &Store{db: db}
	if err := s.configure(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	_ = os.Chmod(path, 0o600)
	return s, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) configure() error {
	for _, stmt := range []string{
		"PRAGMA foreign_keys = ON",
		"PRAGMA busy_timeout = 5000",
		"PRAGMA journal_mode = WAL",
	} {
		if _, err := s.db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS app_metadata (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS app_config (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
			disabled INTEGER NOT NULL DEFAULT 0,
			must_change_password INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			token_hash TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS cluster_combos (
			id TEXT PRIMARY KEY,
			cluster_id TEXT NOT NULL,
			namespace TEXT NOT NULL,
			alias TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE(cluster_id, namespace)
		)`,
		`CREATE TABLE IF NOT EXISTS user_scope_grants (
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			combo_id TEXT NOT NULL REFERENCES cluster_combos(id) ON DELETE CASCADE,
			access_role TEXT NOT NULL DEFAULT 'operator' CHECK (access_role IN ('viewer', 'operator')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY(user_id, combo_id)
		)`,
		`CREATE TABLE IF NOT EXISTS scope_groups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE COLLATE NOCASE,
			description TEXT NOT NULL DEFAULT '',
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS scope_group_members (
			group_id INTEGER NOT NULL REFERENCES scope_groups(id) ON DELETE CASCADE,
			combo_id TEXT NOT NULL UNIQUE REFERENCES cluster_combos(id) ON DELETE CASCADE,
			created_at INTEGER NOT NULL,
			PRIMARY KEY(group_id, combo_id)
		)`,
		`CREATE TABLE IF NOT EXISTS user_scope_group_grants (
			user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			group_id INTEGER NOT NULL REFERENCES scope_groups(id) ON DELETE CASCADE,
			access_role TEXT NOT NULL CHECK (access_role IN ('viewer', 'operator')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY(user_id, group_id)
		)`,
		`CREATE TABLE IF NOT EXISTS audit_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER,
			username TEXT NOT NULL,
			action TEXT NOT NULL,
			method TEXT NOT NULL DEFAULT '',
			path TEXT NOT NULL DEFAULT '',
			cluster_id TEXT NOT NULL DEFAULT '',
			namespace TEXT NOT NULL DEFAULT '',
			resource_kind TEXT NOT NULL DEFAULT '',
			resource_name TEXT NOT NULL DEFAULT '',
			result TEXT NOT NULL CHECK (result IN ('success', 'failure', 'denied')),
			status_code INTEGER NOT NULL DEFAULT 0,
			source_ip TEXT NOT NULL DEFAULT '',
			detail TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`,
		`CREATE INDEX IF NOT EXISTS idx_scope_grants_combo_id ON user_scope_grants(combo_id)`,
		`CREATE INDEX IF NOT EXISTS idx_scope_group_members_group_id ON scope_group_members(group_id)`,
		`CREATE INDEX IF NOT EXISTS idx_group_grants_group_id ON user_scope_group_grants(group_id)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)`,
	}
	for _, stmt := range stmts {
		if _, err := s.db.Exec(stmt); err != nil {
			return err
		}
	}
	// Existing installations created user_scope_grants before roles were introduced.
	// Additive migration preserves every existing grant as operator access.
	if err := s.ensureColumn("user_scope_grants", "access_role", `TEXT NOT NULL DEFAULT 'operator' CHECK (access_role IN ('viewer', 'operator'))`); err != nil {
		return err
	}
	if err := s.ensureColumn("user_scope_grants", "updated_at", `INTEGER NOT NULL DEFAULT 0`); err != nil {
		return err
	}
	if _, err := s.db.Exec(`UPDATE user_scope_grants SET updated_at = created_at WHERE updated_at = 0`); err != nil {
		return err
	}
	return nil
}

func (s *Store) ensureColumn(table, column, definition string) error {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, table, column).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	_, err := s.db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN %s %s`, table, column, definition))
	return err
}

func (s *Store) IsInitialized(ctx context.Context) (bool, error) {
	n, err := s.UserCount(ctx)
	return n > 0, err
}

func (s *Store) UserCount(ctx context.Context) (int, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

func (s *Store) BootstrapAdmin(ctx context.Context, password string) error {
	if err := ValidateNewPassword("", password); err != nil {
		return err
	}
	initialized, err := s.IsInitialized(ctx)
	if err != nil {
		return err
	}
	if initialized {
		return ErrAlreadyInitialized
	}
	if err := s.MigrateLegacyConfig(ctx); err != nil {
		return err
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	_, err = s.db.ExecContext(
		ctx,
		`INSERT INTO users(username, password_hash, role, disabled, must_change_password, created_at, updated_at)
		 VALUES('admin', ?, 'admin', 0, 0, ?, ?)`,
		hash,
		now,
		now,
	)
	return err
}

func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func ValidateNewPassword(oldPassword, newPassword string) error {
	if len(newPassword) < 8 {
		return errors.New("密码至少需要 8 位")
	}
	if newPassword == DefaultUserPassword {
		return errors.New("新密码不能使用默认密码")
	}
	if oldPassword != "" && newPassword == oldPassword {
		return errors.New("新密码不能与旧密码相同")
	}
	return nil
}

func ValidateUsername(username string) error {
	if len(username) < 3 || len(username) > 64 {
		return errors.New("用户名长度需为 3-64 位")
	}
	for _, r := range username {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' {
			continue
		}
		return errors.New("用户名仅支持字母、数字、点、下划线和短横线")
	}
	return nil
}

func NewSessionToken() (token string, tokenHash string, err error) {
	var b [32]byte
	if _, err = rand.Read(b[:]); err != nil {
		return "", "", err
	}
	token = base64.RawURLEncoding.EncodeToString(b[:])
	sum := sha256.Sum256([]byte(token))
	tokenHash = hex.EncodeToString(sum[:])
	return token, tokenHash, nil
}

func HashSessionToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *Store) UserByUsername(ctx context.Context, username string) (UserWithPassword, error) {
	var u UserWithPassword
	var disabled, mustChange int
	err := s.db.QueryRowContext(
		ctx,
		`SELECT id, username, password_hash, role, disabled, must_change_password, created_at, updated_at
		 FROM users WHERE username = ?`,
		username,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &disabled, &mustChange, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return u, err
	}
	u.Disabled = disabled != 0
	u.MustChangePassword = mustChange != 0
	return u, nil
}

func (s *Store) UserByID(ctx context.Context, id int64) (UserWithPassword, error) {
	var u UserWithPassword
	var disabled, mustChange int
	err := s.db.QueryRowContext(
		ctx,
		`SELECT id, username, password_hash, role, disabled, must_change_password, created_at, updated_at
		 FROM users WHERE id = ?`,
		id,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &disabled, &mustChange, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return u, err
	}
	u.Disabled = disabled != 0
	u.MustChangePassword = mustChange != 0
	return u, nil
}

func (s *Store) Authenticate(ctx context.Context, username, password string) (User, error) {
	u, err := s.UserByUsername(ctx, strings.TrimSpace(username))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return User{}, ErrInvalidCredentials
		}
		return User{}, err
	}
	if u.Disabled {
		return User{}, ErrUserDisabled
	}
	if !CheckPassword(u.PasswordHash, password) {
		return User{}, ErrInvalidCredentials
	}
	return u.User, nil
}

func (s *Store) CreateSession(ctx context.Context, userID int64, tokenHash string, expiresAt time.Time) error {
	now := time.Now().UnixMilli()
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO sessions(token_hash, user_id, expires_at, created_at, updated_at)
		 VALUES(?, ?, ?, ?, ?)`,
		tokenHash,
		userID,
		expiresAt.UnixMilli(),
		now,
		now,
	)
	return err
}

func (s *Store) ValidateSession(ctx context.Context, tokenHash string, now time.Time) (User, time.Time, error) {
	var u User
	var disabled, mustChange int
	var expiresMs int64
	err := s.db.QueryRowContext(
		ctx,
		`SELECT u.id, u.username, u.role, u.disabled, u.must_change_password, u.created_at, u.updated_at, s.expires_at
		 FROM sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.token_hash = ?`,
		tokenHash,
	).Scan(&u.ID, &u.Username, &u.Role, &disabled, &mustChange, &u.CreatedAt, &u.UpdatedAt, &expiresMs)
	if err != nil {
		return User{}, time.Time{}, err
	}
	u.Disabled = disabled != 0
	u.MustChangePassword = mustChange != 0
	expiresAt := time.UnixMilli(expiresMs)
	if !expiresAt.After(now) {
		_ = s.DeleteSession(ctx, tokenHash)
		return User{}, time.Time{}, ErrInvalidCredentials
	}
	if u.Disabled {
		_ = s.DeleteUserSessions(ctx, u.ID)
		return User{}, time.Time{}, ErrUserDisabled
	}
	return u, expiresAt, nil
}

func (s *Store) RenewSession(ctx context.Context, tokenHash string, expiresAt time.Time) error {
	res, err := s.db.ExecContext(
		ctx,
		`UPDATE sessions SET expires_at = ?, updated_at = ? WHERE token_hash = ?`,
		expiresAt.UnixMilli(),
		time.Now().UnixMilli(),
		tokenHash,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (s *Store) DeleteUserSessions(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID)
	return err
}

func (s *Store) DeleteUserSessionsExcept(ctx context.Context, userID int64, keepTokenHash string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?`, userID, keepTokenHash)
	return err
}

func (s *Store) CreateNormalUser(ctx context.Context, username string) (User, error) {
	username = strings.TrimSpace(username)
	if err := ValidateUsername(username); err != nil {
		return User{}, err
	}
	hash, err := HashPassword(DefaultUserPassword)
	if err != nil {
		return User{}, err
	}
	now := time.Now().UnixMilli()
	res, err := s.db.ExecContext(
		ctx,
		`INSERT INTO users(username, password_hash, role, disabled, must_change_password, created_at, updated_at)
		 VALUES(?, ?, 'user', 0, 1, ?, ?)`,
		username,
		hash,
		now,
		now,
	)
	if err != nil {
		return User{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return User{}, err
	}
	u, err := s.UserByID(ctx, id)
	if err != nil {
		return User{}, err
	}
	return u.User, nil
}

func (s *Store) ListUsers(ctx context.Context) ([]AdminUserRow, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id, username, role, disabled, must_change_password, created_at, updated_at
		 FROM users
		 ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, username`,
	)
	if err != nil {
		return nil, err
	}
	out := []AdminUserRow{}
	for rows.Next() {
		var row AdminUserRow
		var disabled, mustChange int
		if err := rows.Scan(&row.ID, &row.Username, &row.Role, &disabled, &mustChange, &row.CreatedAt, &row.UpdatedAt); err != nil {
			_ = rows.Close()
			return nil, err
		}
		row.Disabled = disabled != 0
		row.MustChangePassword = mustChange != 0
		out = append(out, row)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	allScopes, err := s.ListCombos(ctx)
	if err != nil {
		return nil, err
	}
	for i := range out {
		if out[i].Role == RoleAdmin {
			out[i].ScopeCount = len(allScopes)
			continue
		}
		scopes, err := s.ListAuthorizedScopesForUser(ctx, out[i].User)
		if err != nil {
			return nil, err
		}
		out[i].ScopeCount = len(scopes)
	}
	return out, nil
}

func (s *Store) SetUserDisabled(ctx context.Context, id int64, disabled bool) error {
	u, err := s.UserByID(ctx, id)
	if err != nil {
		return err
	}
	if u.Role == RoleAdmin {
		return errors.New("admin 用户不能禁用")
	}
	now := time.Now().UnixMilli()
	v := 0
	if disabled {
		v = 1
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?`, v, now, id); err != nil {
		return err
	}
	if disabled {
		return s.DeleteUserSessions(ctx, id)
	}
	return nil
}

func (s *Store) ResetUserPassword(ctx context.Context, id int64) error {
	u, err := s.UserByID(ctx, id)
	if err != nil {
		return err
	}
	if u.Role == RoleAdmin {
		return errors.New("admin 密码请通过修改密码功能更新")
	}
	hash, err := HashPassword(DefaultUserPassword)
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	if _, err := s.db.ExecContext(
		ctx,
		`UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?`,
		hash,
		now,
		id,
	); err != nil {
		return err
	}
	return s.DeleteUserSessions(ctx, id)
}

func (s *Store) ChangePassword(ctx context.Context, id int64, oldPassword, newPassword, currentTokenHash string) error {
	u, err := s.UserByID(ctx, id)
	if err != nil {
		return err
	}
	if oldPassword == "" {
		if !u.MustChangePassword || !CheckPassword(u.PasswordHash, DefaultUserPassword) {
			return ErrInvalidCredentials
		}
	} else if !CheckPassword(u.PasswordHash, oldPassword) {
		return ErrInvalidCredentials
	}
	if err := ValidateNewPassword(oldPassword, newPassword); err != nil {
		return err
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	if _, err := s.db.ExecContext(
		ctx,
		`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`,
		hash,
		now,
		id,
	); err != nil {
		return err
	}
	if currentTokenHash != "" {
		return s.DeleteUserSessionsExcept(ctx, id, currentTokenHash)
	}
	return nil
}

func (s *Store) DeleteUser(ctx context.Context, id int64) error {
	u, err := s.UserByID(ctx, id)
	if err != nil {
		return err
	}
	if u.Role == RoleAdmin {
		return errors.New("admin 用户不能删除")
	}
	if !u.Disabled {
		return errors.New("请先禁用用户")
	}
	_, err = s.db.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
	return err
}

func ComboID(clusterID, namespace string) string {
	return fmt.Sprintf("%s|%s", clusterID, namespace)
}

func (s *Store) ListCombos(ctx context.Context) ([]ClusterCombo, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, cluster_id, namespace, alias FROM cluster_combos ORDER BY cluster_id, namespace`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCombos(rows)
}

func (s *Store) ListCombosForUser(ctx context.Context, user User) ([]ClusterCombo, error) {
	scopes, err := s.ListAuthorizedScopesForUser(ctx, user)
	if err != nil {
		return nil, err
	}
	out := make([]ClusterCombo, 0, len(scopes))
	for _, scope := range scopes {
		out = append(out, scope.ClusterCombo)
	}
	return out, nil
}

func scanCombos(rows *sql.Rows) ([]ClusterCombo, error) {
	out := []ClusterCombo{}
	for rows.Next() {
		var c ClusterCombo
		if err := rows.Scan(&c.ID, &c.ClusterID, &c.Namespace, &c.Alias); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) UpsertCombo(ctx context.Context, clusterID, namespace, alias string) ([]ClusterCombo, error) {
	clusterID = strings.TrimSpace(clusterID)
	namespace = strings.TrimSpace(namespace)
	alias = strings.TrimSpace(alias)
	if clusterID == "" || namespace == "" {
		return nil, errors.New("clusterId 与 namespace 均不能为空")
	}
	id := ComboID(clusterID, namespace)
	now := time.Now().UnixMilli()
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO cluster_combos(id, cluster_id, namespace, alias, created_at, updated_at)
		 VALUES(?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET alias = excluded.alias, updated_at = excluded.updated_at`,
		id,
		clusterID,
		namespace,
		alias,
		now,
		now,
	)
	if err != nil {
		return nil, err
	}
	return s.ListCombos(ctx)
}

func (s *Store) UpdateComboAlias(ctx context.Context, id, alias string) ([]ClusterCombo, error) {
	res, err := s.db.ExecContext(ctx, `UPDATE cluster_combos SET alias = ?, updated_at = ? WHERE id = ?`, strings.TrimSpace(alias), time.Now().UnixMilli(), id)
	if err != nil {
		return nil, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, sql.ErrNoRows
	}
	return s.ListCombos(ctx)
}

func (s *Store) DeleteCombo(ctx context.Context, id string) ([]ClusterCombo, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM cluster_combos WHERE id = ?`, id)
	if err != nil {
		return nil, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, sql.ErrNoRows
	}
	return s.ListCombos(ctx)
}

func (s *Store) ComboByID(ctx context.Context, id string) (ClusterCombo, error) {
	var c ClusterCombo
	err := s.db.QueryRowContext(ctx, `SELECT id, cluster_id, namespace, alias FROM cluster_combos WHERE id = ?`, id).
		Scan(&c.ID, &c.ClusterID, &c.Namespace, &c.Alias)
	return c, err
}

func (s *Store) UserHasScope(ctx context.Context, user User, clusterID, namespace string) (bool, error) {
	_, ok, err := s.UserAccessRoleForScope(ctx, user, clusterID, namespace)
	return ok, err
}

func (s *Store) UserHasAnyScopeForCluster(ctx context.Context, user User, clusterID string) (bool, error) {
	if user.Role == RoleAdmin {
		return true, nil
	}
	scopes, err := s.ListAuthorizedScopesForUser(ctx, user)
	if err != nil {
		return false, err
	}
	for _, scope := range scopes {
		if scope.ClusterID == clusterID {
			return true, nil
		}
	}
	return false, nil
}

func (s *Store) AuthorizedNamespacesForCluster(ctx context.Context, user User, clusterID string) ([]string, error) {
	if user.Role == RoleAdmin {
		return nil, nil
	}
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT c.namespace
		 FROM cluster_combos c
		 JOIN (
			SELECT combo_id
			FROM user_scope_grants
			WHERE user_id = ?
			UNION
			SELECT gm.combo_id
			FROM user_scope_group_grants gg
			JOIN scope_group_members gm ON gm.group_id = gg.group_id
			WHERE gg.user_id = ?
		 ) allowed ON allowed.combo_id = c.id
		 WHERE c.cluster_id = ?
		 ORDER BY c.namespace`,
		user.ID,
		user.ID,
		clusterID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var ns string
		if err := rows.Scan(&ns); err != nil {
			return nil, err
		}
		out = append(out, ns)
	}
	return out, rows.Err()
}

func (s *Store) ListUserScopeIDs(ctx context.Context, userID int64) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT combo_id FROM user_scope_grants WHERE user_id = ? ORDER BY combo_id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Store) SetUserScopeIDs(ctx context.Context, userID int64, scopeIDs []string) error {
	u, err := s.UserByID(ctx, userID)
	if err != nil {
		return err
	}
	if u.Role == RoleAdmin {
		return errors.New("admin 用户无需配置作用域授权")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_scope_grants WHERE user_id = ?`, userID); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	for _, id := range dedupeStrings(scopeIDs) {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		var exists int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM cluster_combos WHERE id = ?`, id).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			return fmt.Errorf("作用域不存在：%s", id)
		}
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO user_scope_grants(user_id, combo_id, access_role, created_at, updated_at)
			 VALUES(?, ?, ?, ?, ?)`,
			userID,
			id,
			AccessRoleOperator,
			now,
			now,
		); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	tx = nil
	return nil
}

func dedupeStrings(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, v := range values {
		if seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}

func (s *Store) GetConfig(ctx context.Context, key string) (string, error) {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM app_config WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

func (s *Store) SetConfig(ctx context.Context, key, value string) error {
	now := time.Now().UnixMilli()
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO app_config(key, value, updated_at) VALUES(?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key,
		value,
		now,
	)
	return err
}

func (s *Store) SetMetadata(ctx context.Context, key, value string) error {
	now := time.Now().UnixMilli()
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO app_metadata(key, value, updated_at) VALUES(?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key,
		value,
		now,
	)
	return err
}

func (s *Store) Metadata(ctx context.Context, key string) (string, error) {
	var v string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM app_metadata WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

func (s *Store) MigrateLegacyConfig(ctx context.Context) error {
	migrated, err := s.Metadata(ctx, "legacy_config_migrated_at")
	if err != nil {
		return err
	}
	if migrated != "" {
		return nil
	}

	if current, err := s.GetConfig(ctx, "kubeconfig_dir"); err != nil {
		return err
	} else if current == "" {
		if b, err := os.ReadFile("config/kubeconfig-dir.override"); err == nil {
			if dir := strings.TrimSpace(string(b)); dir != "" {
				if err := s.SetConfig(ctx, "kubeconfig_dir", dir); err != nil {
					return err
				}
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}

	if b, err := os.ReadFile("config/cluster-combos.json"); err == nil {
		var items []ClusterCombo
		if err := json.Unmarshal(b, &items); err != nil {
			return fmt.Errorf("迁移旧作用域配置失败: %w", err)
		}
		for _, item := range items {
			item.ClusterID = strings.TrimSpace(item.ClusterID)
			item.Namespace = strings.TrimSpace(item.Namespace)
			if item.ClusterID == "" || item.Namespace == "" {
				continue
			}
			if _, err := s.UpsertCombo(ctx, item.ClusterID, item.Namespace, item.Alias); err != nil {
				return err
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	return s.SetMetadata(ctx, "legacy_config_migrated_at", time.Now().Format(time.RFC3339))
}

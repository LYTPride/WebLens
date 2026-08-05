package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

type AccessRole string

const (
	AccessRoleViewer   AccessRole = "viewer"
	AccessRoleOperator AccessRole = "operator"
)

type Capability string

const (
	CapabilityResourceRead  Capability = "resource.read"
	CapabilityResourceWrite Capability = "resource.write"
	CapabilityPodLogs       Capability = "pod.logs"
	CapabilityPodExec       Capability = "pod.exec"
	CapabilityFileRead      Capability = "file.read"
	CapabilityFileWrite     Capability = "file.write"
	CapabilityPlatform      Capability = "platform.manage"
	CapabilityAuditRead     Capability = "audit.read"
)

var viewerCapabilities = []Capability{
	CapabilityResourceRead,
	CapabilityPodLogs,
	CapabilityFileRead,
}

var operatorCapabilities = []Capability{
	CapabilityResourceRead,
	CapabilityResourceWrite,
	CapabilityPodLogs,
	CapabilityPodExec,
	CapabilityFileRead,
	CapabilityFileWrite,
}

type ScopeGroupSummary struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type AuthorizedScope struct {
	ClusterCombo
	Group        *ScopeGroupSummary `json:"group,omitempty"`
	AccessRole   AccessRole         `json:"accessRole"`
	Capabilities []Capability       `json:"capabilities"`
}

type ScopeGroup struct {
	ID          int64    `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	SortOrder   int      `json:"sortOrder"`
	ScopeIDs    []string `json:"scopeIds"`
	ScopeCount  int      `json:"scopeCount"`
	GrantCount  int      `json:"grantCount"`
	CreatedAt   int64    `json:"createdAt"`
	UpdatedAt   int64    `json:"updatedAt"`
}

type ScopeGrant struct {
	ScopeID string     `json:"scopeId"`
	Role    AccessRole `json:"role"`
}

type GroupGrant struct {
	GroupID int64      `json:"groupId"`
	Role    AccessRole `json:"role"`
}

type UserGrants struct {
	GroupGrants []GroupGrant `json:"groupGrants"`
	ScopeGrants []ScopeGrant `json:"scopeGrants"`
}

type AuditRecord struct {
	UserID       *int64
	Username     string
	Action       string
	Method       string
	Path         string
	ClusterID    string
	Namespace    string
	ResourceKind string
	ResourceName string
	Result       string
	StatusCode   int
	SourceIP     string
	Detail       string
}

type AuditEntry struct {
	ID           int64  `json:"id"`
	UserID       *int64 `json:"userId,omitempty"`
	Username     string `json:"username"`
	Action       string `json:"action"`
	Method       string `json:"method"`
	Path         string `json:"path"`
	ClusterID    string `json:"clusterId,omitempty"`
	Namespace    string `json:"namespace,omitempty"`
	ResourceKind string `json:"resourceKind,omitempty"`
	ResourceName string `json:"resourceName,omitempty"`
	Result       string `json:"result"`
	StatusCode   int    `json:"statusCode"`
	SourceIP     string `json:"sourceIp,omitempty"`
	Detail       string `json:"detail,omitempty"`
	CreatedAt    int64  `json:"createdAt"`
}

type AuditFilter struct {
	UserID int64
	Action string
	Result string
	Limit  int
}

func ValidateAccessRole(role AccessRole) error {
	if role != AccessRoleViewer && role != AccessRoleOperator {
		return fmt.Errorf("不支持的作用域角色：%s", role)
	}
	return nil
}

func CapabilitiesForRole(role AccessRole) []Capability {
	source := viewerCapabilities
	if role == AccessRoleOperator {
		source = operatorCapabilities
	}
	out := make([]Capability, len(source))
	copy(out, source)
	return out
}

func RoleAllows(role AccessRole, capability Capability) bool {
	for _, item := range CapabilitiesForRole(role) {
		if item == capability {
			return true
		}
	}
	return false
}

func higherRole(current, candidate AccessRole) AccessRole {
	if current == AccessRoleOperator || candidate == AccessRoleOperator {
		return AccessRoleOperator
	}
	if current == AccessRoleViewer || candidate == AccessRoleViewer {
		return AccessRoleViewer
	}
	return ""
}

func (s *Store) ListAuthorizedScopesForUser(ctx context.Context, user User) ([]AuthorizedScope, error) {
	var (
		rows *sql.Rows
		err  error
	)
	if user.Role == RoleAdmin {
		rows, err = s.db.QueryContext(ctx, `
			SELECT c.id, c.cluster_id, c.namespace, c.alias, sg.id, sg.name, 'operator'
			FROM cluster_combos c
			LEFT JOIN scope_group_members gm ON gm.combo_id = c.id
			LEFT JOIN scope_groups sg ON sg.id = gm.group_id
			ORDER BY COALESCE(sg.sort_order, 2147483647), COALESCE(sg.name, ''), c.cluster_id, c.namespace`)
	} else {
		rows, err = s.db.QueryContext(ctx, `
			SELECT c.id, c.cluster_id, c.namespace, c.alias, sg.id, sg.name, grants.access_role
			FROM (
				SELECT combo_id, access_role
				FROM user_scope_grants
				WHERE user_id = ?
				UNION ALL
				SELECT gm.combo_id, gg.access_role
				FROM user_scope_group_grants gg
				JOIN scope_group_members gm ON gm.group_id = gg.group_id
				WHERE gg.user_id = ?
			) grants
			JOIN cluster_combos c ON c.id = grants.combo_id
			LEFT JOIN scope_group_members gm ON gm.combo_id = c.id
			LEFT JOIN scope_groups sg ON sg.id = gm.group_id
			ORDER BY COALESCE(sg.sort_order, 2147483647), COALESCE(sg.name, ''), c.cluster_id, c.namespace`,
			user.ID,
			user.ID,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	orderedIDs := make([]string, 0)
	byID := make(map[string]AuthorizedScope)
	for rows.Next() {
		var (
			item      AuthorizedScope
			groupID   sql.NullInt64
			groupName sql.NullString
			role      string
		)
		if err := rows.Scan(
			&item.ID,
			&item.ClusterID,
			&item.Namespace,
			&item.Alias,
			&groupID,
			&groupName,
			&role,
		); err != nil {
			return nil, err
		}
		if groupID.Valid {
			item.Group = &ScopeGroupSummary{ID: groupID.Int64, Name: groupName.String}
		}
		item.AccessRole = AccessRole(role)
		if prev, ok := byID[item.ID]; ok {
			prev.AccessRole = higherRole(prev.AccessRole, item.AccessRole)
			byID[item.ID] = prev
			continue
		}
		orderedIDs = append(orderedIDs, item.ID)
		byID[item.ID] = item
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]AuthorizedScope, 0, len(orderedIDs))
	for _, id := range orderedIDs {
		item := byID[id]
		item.Capabilities = CapabilitiesForRole(item.AccessRole)
		out = append(out, item)
	}
	return out, nil
}

func (s *Store) UserAccessRoleForScope(ctx context.Context, user User, clusterID, namespace string) (AccessRole, bool, error) {
	if user.Role == RoleAdmin {
		return AccessRoleOperator, true, nil
	}
	if strings.TrimSpace(clusterID) == "" || strings.TrimSpace(namespace) == "" {
		return "", false, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT grants.access_role
		FROM (
			SELECT g.access_role
			FROM user_scope_grants g
			JOIN cluster_combos c ON c.id = g.combo_id
			WHERE g.user_id = ? AND c.cluster_id = ? AND c.namespace = ?
			UNION ALL
			SELECT gg.access_role
			FROM user_scope_group_grants gg
			JOIN scope_group_members gm ON gm.group_id = gg.group_id
			JOIN cluster_combos c ON c.id = gm.combo_id
			WHERE gg.user_id = ? AND c.cluster_id = ? AND c.namespace = ?
		) grants`,
		user.ID,
		clusterID,
		namespace,
		user.ID,
		clusterID,
		namespace,
	)
	if err != nil {
		return "", false, err
	}
	defer rows.Close()
	var effective AccessRole
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return "", false, err
		}
		effective = higherRole(effective, AccessRole(raw))
	}
	if err := rows.Err(); err != nil {
		return "", false, err
	}
	return effective, effective != "", nil
}

func (s *Store) UserHasCapability(ctx context.Context, user User, clusterID, namespace string, capability Capability) (bool, error) {
	if user.Role == RoleAdmin {
		return true, nil
	}
	role, ok, err := s.UserAccessRoleForScope(ctx, user, clusterID, namespace)
	if err != nil || !ok {
		return false, err
	}
	return RoleAllows(role, capability), nil
}

func validateGroupFields(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 64 {
		return "", errors.New("分组名称长度需为 1-64 位")
	}
	return name, nil
}

func (s *Store) ListScopeGroups(ctx context.Context) ([]ScopeGroup, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT g.id, g.name, g.description, g.sort_order, g.created_at, g.updated_at,
		       COUNT(DISTINCT m.combo_id), COUNT(DISTINCT grants.user_id)
		FROM scope_groups g
		LEFT JOIN scope_group_members m ON m.group_id = g.id
		LEFT JOIN user_scope_group_grants grants ON grants.group_id = g.id
		GROUP BY g.id
		ORDER BY g.sort_order, g.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ScopeGroup{}
	byID := map[int64]int{}
	for rows.Next() {
		var item ScopeGroup
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.Description,
			&item.SortOrder,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.ScopeCount,
			&item.GrantCount,
		); err != nil {
			return nil, err
		}
		item.ScopeIDs = []string{}
		byID[item.ID] = len(out)
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	memberRows, err := s.db.QueryContext(ctx, `
		SELECT group_id, combo_id
		FROM scope_group_members
		ORDER BY group_id, combo_id`)
	if err != nil {
		return nil, err
	}
	defer memberRows.Close()
	for memberRows.Next() {
		var groupID int64
		var scopeID string
		if err := memberRows.Scan(&groupID, &scopeID); err != nil {
			return nil, err
		}
		if index, ok := byID[groupID]; ok {
			out[index].ScopeIDs = append(out[index].ScopeIDs, scopeID)
		}
	}
	return out, memberRows.Err()
}

func (s *Store) CreateScopeGroup(ctx context.Context, name, description string) (ScopeGroup, error) {
	name, err := validateGroupFields(name)
	if err != nil {
		return ScopeGroup{}, err
	}
	now := time.Now().UnixMilli()
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO scope_groups(name, description, sort_order, created_at, updated_at)
		VALUES(?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM scope_groups), 0), ?, ?)`,
		name,
		strings.TrimSpace(description),
		now,
		now,
	)
	if err != nil {
		return ScopeGroup{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return ScopeGroup{}, err
	}
	groups, err := s.ListScopeGroups(ctx)
	if err != nil {
		return ScopeGroup{}, err
	}
	for _, item := range groups {
		if item.ID == id {
			return item, nil
		}
	}
	return ScopeGroup{}, sql.ErrNoRows
}

func (s *Store) UpdateScopeGroup(ctx context.Context, id int64, name, description string, sortOrder int) error {
	name, err := validateGroupFields(name)
	if err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx, `
		UPDATE scope_groups
		SET name = ?, description = ?, sort_order = ?, updated_at = ?
		WHERE id = ?`,
		name,
		strings.TrimSpace(description),
		sortOrder,
		time.Now().UnixMilli(),
		id,
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

func (s *Store) DeleteScopeGroup(ctx context.Context, id int64) error {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM scope_group_members WHERE group_id = ?`, id).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return errors.New("请先移出分组中的全部作用域")
	}
	res, err := s.db.ExecContext(ctx, `DELETE FROM scope_groups WHERE id = ?`, id)
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

func (s *Store) SetScopeGroupScopeIDs(ctx context.Context, groupID int64, scopeIDs []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM scope_groups WHERE id = ?`, groupID).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return sql.ErrNoRows
	}
	ids := dedupeStrings(scopeIDs)
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			return errors.New("作用域 ID 不能为空")
		}
		var comboExists int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM cluster_combos WHERE id = ?`, id).Scan(&comboExists); err != nil {
			return err
		}
		if comboExists == 0 {
			return fmt.Errorf("作用域不存在：%s", id)
		}
		var currentGroup sql.NullInt64
		err := tx.QueryRowContext(ctx, `SELECT group_id FROM scope_group_members WHERE combo_id = ?`, id).Scan(&currentGroup)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if currentGroup.Valid && currentGroup.Int64 != groupID {
			return fmt.Errorf("作用域 %s 已属于其他分组", id)
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM scope_group_members WHERE group_id = ?`, groupID); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO scope_group_members(group_id, combo_id, created_at)
			VALUES(?, ?, ?)`,
			groupID,
			strings.TrimSpace(id),
			now,
		); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE scope_groups SET updated_at = ? WHERE id = ?`, now, groupID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) ListUserGrants(ctx context.Context, userID int64) (UserGrants, error) {
	u, err := s.UserByID(ctx, userID)
	if err != nil {
		return UserGrants{}, err
	}
	if u.Role == RoleAdmin {
		return UserGrants{}, errors.New("admin 用户无需配置作用域授权")
	}
	out := UserGrants{GroupGrants: []GroupGrant{}, ScopeGrants: []ScopeGrant{}}
	groupRows, err := s.db.QueryContext(ctx, `
		SELECT group_id, access_role
		FROM user_scope_group_grants
		WHERE user_id = ?
		ORDER BY group_id`, userID)
	if err != nil {
		return UserGrants{}, err
	}
	for groupRows.Next() {
		var item GroupGrant
		if err := groupRows.Scan(&item.GroupID, &item.Role); err != nil {
			_ = groupRows.Close()
			return UserGrants{}, err
		}
		out.GroupGrants = append(out.GroupGrants, item)
	}
	if err := groupRows.Close(); err != nil {
		return UserGrants{}, err
	}

	scopeRows, err := s.db.QueryContext(ctx, `
		SELECT combo_id, access_role
		FROM user_scope_grants
		WHERE user_id = ?
		ORDER BY combo_id`, userID)
	if err != nil {
		return UserGrants{}, err
	}
	defer scopeRows.Close()
	for scopeRows.Next() {
		var item ScopeGrant
		if err := scopeRows.Scan(&item.ScopeID, &item.Role); err != nil {
			return UserGrants{}, err
		}
		out.ScopeGrants = append(out.ScopeGrants, item)
	}
	return out, scopeRows.Err()
}

func (s *Store) SetUserGrants(ctx context.Context, userID int64, grants UserGrants) error {
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
	defer func() { _ = tx.Rollback() }()

	now := time.Now().UnixMilli()
	groupSeen := map[int64]bool{}
	for _, item := range grants.GroupGrants {
		if groupSeen[item.GroupID] {
			return fmt.Errorf("作用域分组重复：%d", item.GroupID)
		}
		groupSeen[item.GroupID] = true
		if err := ValidateAccessRole(item.Role); err != nil {
			return err
		}
		var exists int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM scope_groups WHERE id = ?`, item.GroupID).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			return fmt.Errorf("作用域分组不存在：%d", item.GroupID)
		}
	}
	scopeSeen := map[string]bool{}
	for _, item := range grants.ScopeGrants {
		id := strings.TrimSpace(item.ScopeID)
		if id == "" {
			return errors.New("作用域 ID 不能为空")
		}
		if scopeSeen[id] {
			return fmt.Errorf("作用域授权重复：%s", id)
		}
		scopeSeen[id] = true
		if err := ValidateAccessRole(item.Role); err != nil {
			return err
		}
		var exists int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM cluster_combos WHERE id = ?`, id).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			return fmt.Errorf("作用域不存在：%s", id)
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_scope_group_grants WHERE user_id = ?`, userID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_scope_grants WHERE user_id = ?`, userID); err != nil {
		return err
	}
	for _, item := range grants.GroupGrants {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO user_scope_group_grants(user_id, group_id, access_role, created_at, updated_at)
			VALUES(?, ?, ?, ?, ?)`,
			userID,
			item.GroupID,
			item.Role,
			now,
			now,
		); err != nil {
			return err
		}
	}
	for _, item := range grants.ScopeGrants {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO user_scope_grants(user_id, combo_id, access_role, created_at, updated_at)
			VALUES(?, ?, ?, ?, ?)`,
			userID,
			strings.TrimSpace(item.ScopeID),
			item.Role,
			now,
			now,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) RecordAudit(ctx context.Context, record AuditRecord) error {
	if strings.TrimSpace(record.Username) == "" || strings.TrimSpace(record.Action) == "" {
		return errors.New("审计记录缺少用户或操作")
	}
	if record.Result != "success" && record.Result != "failure" && record.Result != "denied" {
		return errors.New("审计结果不合法")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO audit_logs(
			user_id, username, action, method, path, cluster_id, namespace,
			resource_kind, resource_name, result, status_code, source_ip, detail, created_at
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		record.UserID,
		record.Username,
		record.Action,
		record.Method,
		record.Path,
		record.ClusterID,
		record.Namespace,
		record.ResourceKind,
		record.ResourceName,
		record.Result,
		record.StatusCode,
		record.SourceIP,
		record.Detail,
		time.Now().UnixMilli(),
	)
	return err
}

func (s *Store) ListAuditLogs(ctx context.Context, filter AuditFilter) ([]AuditEntry, error) {
	limit := filter.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 200 {
		limit = 200
	}
	query := `
		SELECT id, user_id, username, action, method, path, cluster_id, namespace,
		       resource_kind, resource_name, result, status_code, source_ip, detail, created_at
		FROM audit_logs
		WHERE (? = 0 OR user_id = ?)
		  AND (? = '' OR action = ?)
		  AND (? = '' OR result = ?)
		ORDER BY created_at DESC, id DESC
		LIMIT ?`
	rows, err := s.db.QueryContext(
		ctx,
		query,
		filter.UserID,
		filter.UserID,
		filter.Action,
		filter.Action,
		filter.Result,
		filter.Result,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var (
			item   AuditEntry
			userID sql.NullInt64
		)
		if err := rows.Scan(
			&item.ID,
			&userID,
			&item.Username,
			&item.Action,
			&item.Method,
			&item.Path,
			&item.ClusterID,
			&item.Namespace,
			&item.ResourceKind,
			&item.ResourceName,
			&item.Result,
			&item.StatusCode,
			&item.SourceIP,
			&item.Detail,
			&item.CreatedAt,
		); err != nil {
			return nil, err
		}
		if userID.Valid {
			id := userID.Int64
			item.UserID = &id
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

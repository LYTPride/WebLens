package httpapi

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"weblens/server/internal/auth"

	"github.com/gin-gonic/gin"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	typedcorev1 "k8s.io/client-go/kubernetes/typed/core/v1"
)

type secretTestClient struct {
	typedcorev1.SecretInterface
	secret       *corev1.Secret
	updateErr    error
	watchVersion string
}

func (c *secretTestClient) Get(_ context.Context, name string, _ metav1.GetOptions) (*corev1.Secret, error) {
	if c.secret == nil || c.secret.Name != name {
		return nil, apierrors.NewNotFound(schema.GroupResource{Resource: "secrets"}, name)
	}
	return c.secret.DeepCopy(), nil
}

func (c *secretTestClient) List(_ context.Context, _ metav1.ListOptions) (*corev1.SecretList, error) {
	return &corev1.SecretList{
		ListMeta: metav1.ListMeta{ResourceVersion: c.secret.ResourceVersion},
		Items:    []corev1.Secret{*c.secret.DeepCopy()},
	}, nil
}

func (c *secretTestClient) Watch(_ context.Context, opts metav1.ListOptions) (watch.Interface, error) {
	c.watchVersion = opts.ResourceVersion
	w := watch.NewRaceFreeFake()
	w.Add(c.secret)
	w.Modify(c.secret)
	w.Delete(c.secret)
	w.Error(&metav1.Status{Message: string(c.secret.Data["password"])})
	return w, nil
}

func (c *secretTestClient) Update(_ context.Context, secret *corev1.Secret, _ metav1.UpdateOptions) (*corev1.Secret, error) {
	if c.updateErr != nil {
		return nil, c.updateErr
	}
	c.secret = secret.DeepCopy()
	c.secret.ResourceVersion = "43"
	return c.secret.DeepCopy(), nil
}

func (c *secretTestClient) Delete(_ context.Context, name string, opts metav1.DeleteOptions) error {
	if opts.Preconditions == nil || opts.Preconditions.UID == nil || *opts.Preconditions.UID != c.secret.UID {
		return apierrors.NewConflict(schema.GroupResource{Resource: "secrets"}, name, errors.New("UID precondition failed"))
	}
	c.secret = nil
	return nil
}

func TestSecretRoutesRedactAndAuthorize(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx := context.Background()
	store, err := auth.Open(filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	const clusterID = "secret-route-test"
	const namespace = "payments"
	const rootPassword = "Secret-route-test-admin!"
	if err := store.BootstrapAdmin(ctx, rootPassword); err != nil {
		t.Fatal(err)
	}
	root, err := store.Authenticate(ctx, "admin", rootPassword)
	if err != nil {
		t.Fatal(err)
	}
	for _, ns := range []string{namespace, "watch"} {
		if _, err := store.UpsertCombo(ctx, clusterID, ns, ""); err != nil {
			t.Fatal(err)
		}
	}
	newSession := func(username string, role auth.AccessRole) string {
		t.Helper()
		user, temporary, err := store.CreateUser(ctx, root, username, auth.RoleUser)
		if err != nil {
			t.Fatal(err)
		}
		if err := store.ChangePassword(ctx, user.ID, temporary, "Secret-route-test-user!", ""); err != nil {
			t.Fatal(err)
		}
		if err := store.SetUserGrants(ctx, user.ID, auth.UserGrants{ScopeGrants: []auth.ScopeGrant{
			{ScopeID: auth.ComboID(clusterID, namespace), Role: role},
			{ScopeID: auth.ComboID(clusterID, "watch"), Role: role},
		}}); err != nil {
			t.Fatal(err)
		}
		token, hash, err := auth.NewSessionToken()
		if err != nil {
			t.Fatal(err)
		}
		if err := store.CreateSession(ctx, user.ID, hash, time.Now().Add(time.Minute)); err != nil {
			t.Fatal(err)
		}
		return token
	}
	viewer := newSession("secretviewer", auth.AccessRoleViewer)
	operator := newSession("secretoperator", auth.AccessRoleOperator)

	const original = "existing-private-value"
	const newValue = "replacement-private-value"
	const privateKey = "password"
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name: "database", Namespace: namespace, UID: "secret-uid", ResourceVersion: "42",
			Annotations: map[string]string{"kubectl.kubernetes.io/last-applied-configuration": original},
			Labels:      map[string]string{"private-label": original},
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{privateKey: []byte(original), "username": []byte("keep-existing")},
	}
	client := &secretTestClient{secret: secret}
	router := gin.New()
	router.Use(authRequired(store))
	registerSecretRoutes(router, func(id, ns string) (typedcorev1.SecretInterface, bool) {
		return client, id == clusterID && ns == namespace
	})

	listPath := "/api/clusters/" + clusterID + "/secrets"
	secretPath := listPath + "/" + namespace + "/database"
	request := func(method, path, session, payload, reason string, want int) string {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(payload))
		req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: session})
		req.Header.Set("Content-Type", "application/json")
		if reason != "" {
			req.Header.Set(auditReasonHeader, reason)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		if recorder.Code != want {
			t.Fatalf("%s %s status = %d, want %d: %s", method, path, recorder.Code, want, recorder.Body)
		}
		body := recorder.Body.String()
		for _, forbidden := range []string{
			original, newValue, "last-applied", "private-label", "keep-existing",
			base64.StdEncoding.EncodeToString([]byte(original)),
			base64.StdEncoding.EncodeToString([]byte(newValue)),
		} {
			if strings.Contains(body, forbidden) {
				t.Fatalf("%s %s exposed a restricted field or value", method, path)
			}
		}
		return body
	}

	for _, path := range []string{
		listPath + "?namespace=" + namespace,
		listPath + "?namespace=" + namespace, // exercise the summary cache
		listPath + "/watch?namespace=" + namespace + "&resourceVersion=42",
		secretPath + "/describe",
		secretPath + "/yaml",
	} {
		body := request(http.MethodGet, path, viewer, "", "", http.StatusOK)
		if !strings.Contains(body, "database") || strings.Contains(body, privateKey) {
			t.Errorf("GET %s did not return a redacted summary", path)
		}
	}
	if client.watchVersion != "42" {
		t.Fatalf("watch did not resume from the requested list version: %q", client.watchVersion)
	}
	request(http.MethodGet, listPath+"/watch", viewer, "", "", http.StatusForbidden)
	request(http.MethodGet, listPath+"/other/database/describe?namespace=payments", viewer, "", "", http.StatusForbidden)
	request(http.MethodGet, secretPath+"/keys", viewer, "", "", http.StatusForbidden)
	request(http.MethodPatch, secretPath, viewer, "", "rotate", http.StatusForbidden)
	request(http.MethodDelete, secretPath, viewer, "", "remove", http.StatusForbidden)
	request(http.MethodGet, secretPath+"/reveal", operator, "", "", http.StatusNotFound)
	if keys := request(http.MethodGet, secretPath+"/keys", operator, "", "", http.StatusOK); !strings.Contains(keys, privateKey) {
		t.Fatal("operator did not receive the permitted key names")
	}

	rotation := `{"uid":"secret-uid","resourceVersion":"42","key":"password","encoding":"base64","value":"` +
		base64.StdEncoding.EncodeToString([]byte(newValue)) + `"}`
	request(http.MethodPatch, secretPath, operator, rotation, "", http.StatusBadRequest)
	request(http.MethodPatch, secretPath, operator, strings.Replace(rotation, `"42"`, `"41"`, 1), "rotate", http.StatusConflict)
	request(http.MethodPatch, secretPath, operator, rotation, "rotate", http.StatusOK)
	actual, err := client.Get(ctx, secret.Name, metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if string(actual.Data[privateKey]) != newValue || string(actual.Data["username"]) != "keep-existing" {
		t.Fatal("rotation did not preserve the unmodified key")
	}

	currentRotation := strings.Replace(rotation, `"42"`, `"43"`, 1)
	immutable := true
	client.secret.Immutable = &immutable
	request(http.MethodPatch, secretPath, operator, currentRotation, "rotate", http.StatusBadRequest)
	client.secret.Immutable = nil
	client.updateErr = apierrors.NewBadRequest("admission error includes " + newValue)
	request(http.MethodPatch, secretPath, operator, currentRotation, "rotate", http.StatusBadRequest)
	request(http.MethodDelete, secretPath, operator, "", "remove", http.StatusBadRequest)
	request(http.MethodDelete, secretPath+"?uid=old-secret-uid", operator, "", "remove", http.StatusConflict)
	request(http.MethodDelete, secretPath+"?uid=secret-uid", operator, "", "remove", http.StatusNoContent)
	if _, err := client.Get(ctx, secret.Name, metav1.GetOptions{}); !apierrors.IsNotFound(err) {
		t.Fatalf("expected the Secret to be deleted, got %v", err)
	}
}

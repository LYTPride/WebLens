package httpapi

import (
	"encoding/base64"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	typedcorev1 "k8s.io/client-go/kubernetes/typed/core/v1"
	"sigs.k8s.io/yaml"
)

// Use an allowlist even for metadata. Annotations can embed the original Secret manifest.
type secretMetadata struct {
	Name              string      `json:"name"`
	Namespace         string      `json:"namespace"`
	UID               types.UID   `json:"uid"`
	CreationTimestamp metav1.Time `json:"creationTimestamp"`
	ResourceVersion   string      `json:"resourceVersion"`
}

type secretPreview struct {
	metav1.TypeMeta
	Metadata  secretMetadata    `json:"metadata"`
	Type      corev1.SecretType `json:"type"`
	Immutable bool              `json:"immutable"`
}

type secretSummary struct {
	secretPreview
	KeyCount int `json:"keyCount"`
}

type secretSnapshot struct {
	Items           []secretSummary `json:"items"`
	ResourceVersion string          `json:"resourceVersion"`
	ServerTimeMs    int64           `json:"serverTimeMs"`
}

func summarizeSecret(secret *corev1.Secret) secretSummary {
	return secretSummary{
		secretPreview: secretPreview{
			TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "Secret"},
			Metadata: secretMetadata{
				Name:              secret.Name,
				Namespace:         secret.Namespace,
				UID:               secret.UID,
				CreationTimestamp: secret.CreationTimestamp,
				ResourceVersion:   secret.ResourceVersion,
			},
			Type:      secret.Type,
			Immutable: secret.Immutable != nil && *secret.Immutable,
		},
		KeyCount: len(secret.Data),
	}
}

func writeSecretError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"error": message})
}

// Kubernetes validation and admission errors can quote submitted values.
func writeSecretK8sError(c *gin.Context, err error) {
	switch {
	case apierrors.IsForbidden(err), apierrors.IsUnauthorized(err):
		writeSecretError(c, http.StatusForbidden, "Kubernetes 拒绝了该 Secret 操作")
	case apierrors.IsNotFound(err):
		writeSecretError(c, http.StatusNotFound, "Secret 或命名空间不存在")
	case apierrors.IsConflict(err):
		writeSecretError(c, http.StatusConflict, "Secret 已变更，请重新加载后再试")
	case apierrors.IsGone(err), apierrors.IsResourceExpired(err):
		writeSecretError(c, http.StatusGone, "Secret 列表版本已过期")
	case apierrors.IsInvalid(err), apierrors.IsBadRequest(err), apierrors.IsRequestEntityTooLargeError(err):
		writeSecretError(c, http.StatusBadRequest, "Kubernetes 拒绝了新值，请检查 Secret 类型、内容格式和大小")
	default:
		writeSecretError(c, http.StatusBadGateway, "无法从 Kubernetes 完成 Secret 操作")
	}
}

func getSecret(c *gin.Context, client typedcorev1.SecretInterface) (*corev1.Secret, bool) {
	secret, err := client.Get(c.Request.Context(), c.Param("name"), metav1.GetOptions{})
	if err != nil {
		writeSecretK8sError(c, err)
		return nil, false
	}
	return secret, true
}

func invalidateSecretListCache(clusterID, namespace string) {
	listCacheMu.Lock()
	defer listCacheMu.Unlock()
	delete(listCache, listCacheKey("secrets", clusterID, namespace))
	delete(listCache, listCacheKey("secrets", clusterID, corev1.NamespaceAll))
}

func registerSecretRoutes(r *gin.Engine, secretClient func(string, string) (typedcorev1.SecretInterface, bool)) {
	group := r.Group("/api/clusters/:id/secrets", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
	})
	withClient := func(handler func(*gin.Context, typedcorev1.SecretInterface)) gin.HandlerFunc {
		return func(c *gin.Context) {
			namespace := c.Param("namespace")
			if namespace == "" {
				namespace = c.Query("namespace")
			}
			client, ok := secretClient(c.Param("id"), namespace)
			if !ok {
				writeSecretError(c, http.StatusNotFound, "集群不存在")
				return
			}
			handler(c, client)
		}
	}

	group.GET("", withClient(func(c *gin.Context, client typedcorev1.SecretInterface) {
		key := listCacheKey("secrets", c.Param("id"), c.Query("namespace"))
		if snapshot, ok := getListFromCache(key); ok {
			c.JSON(http.StatusOK, snapshot)
			return
		}
		list, err := client.List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			writeSecretK8sError(c, err)
			return
		}
		snapshot := secretSnapshot{
			Items:           make([]secretSummary, 0, len(list.Items)),
			ResourceVersion: list.ResourceVersion,
			ServerTimeMs:    time.Now().UnixMilli(),
		}
		for i := range list.Items {
			snapshot.Items = append(snapshot.Items, summarizeSecret(&list.Items[i]))
		}
		setListCache(key, snapshot)
		c.JSON(http.StatusOK, snapshot)
	}))

	group.GET("/watch", withClient(func(c *gin.Context, client typedcorev1.SecretInterface) {
		w, err := client.Watch(c.Request.Context(), metav1.ListOptions{
			ResourceVersion: c.DefaultQuery("resourceVersion", "0"),
		})
		if err != nil {
			writeSecretK8sError(c, err)
			return
		}
		streamWatch(c, c.Param("id"), c.Query("namespace"), w, func(obj runtime.Object) any {
			if secret, ok := obj.(*corev1.Secret); ok {
				return summarizeSecret(secret)
			}
			return nil
		})
	}))

	group.GET("/:namespace/:name/describe", withClient(func(c *gin.Context, client typedcorev1.SecretInterface) {
		if secret, ok := getSecret(c, client); ok {
			c.JSON(http.StatusOK, summarizeSecret(secret))
		}
	}))

	group.GET("/:namespace/:name/yaml", withClient(func(c *gin.Context, client typedcorev1.SecretInterface) {
		secret, ok := getSecret(c, client)
		if !ok {
			return
		}
		raw, err := yaml.Marshal(summarizeSecret(secret).secretPreview)
		if err != nil {
			writeSecretError(c, http.StatusInternalServerError, "无法生成脱敏 YAML")
			return
		}
		c.Data(http.StatusOK, "text/yaml; charset=utf-8", raw)
	}))

	group.GET("/:namespace/:name/keys", withClient(func(c *gin.Context, client typedcorev1.SecretInterface) {
		secret, ok := getSecret(c, client)
		if !ok {
			return
		}
		keys := make([]string, 0, len(secret.Data))
		for key := range secret.Data {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		c.JSON(http.StatusOK, gin.H{"secret": summarizeSecret(secret), "keys": keys})
	}))

	group.PATCH("/:namespace/:name", withClient(updateSecretKey))
	group.DELETE("/:namespace/:name", withClient(func(c *gin.Context, client typedcorev1.SecretInterface) {
		uid := types.UID(c.Query("uid"))
		if uid == "" {
			writeSecretError(c, http.StatusBadRequest, "缺少 Secret UID")
			return
		}
		options := metav1.DeleteOptions{Preconditions: &metav1.Preconditions{UID: &uid}}
		if err := client.Delete(c.Request.Context(), c.Param("name"), options); err != nil {
			writeSecretK8sError(c, err)
			return
		}
		invalidateSecretListCache(c.Param("id"), c.Param("namespace"))
		c.Status(http.StatusNoContent)
	}))
}

func updateSecretKey(c *gin.Context, client typedcorev1.SecretInterface) {
	var req struct {
		UID             types.UID `json:"uid"`
		ResourceVersion string    `json:"resourceVersion"`
		Key             string    `json:"key"`
		Encoding        string    `json:"encoding"`
		Value           *string   `json:"value"`
	}
	// Kubernetes permits 1 MiB of decoded data. JSON escaping can expand text further.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<20)
	if err := c.ShouldBindJSON(&req); err != nil || req.UID == "" || req.ResourceVersion == "" || req.Key == "" || req.Value == nil {
		writeSecretError(c, http.StatusBadRequest, "缺少有效的 Secret 版本、键名或新值")
		return
	}
	value := []byte(*req.Value)
	switch req.Encoding {
	case "text":
	case "base64":
		var err error
		value, err = base64.StdEncoding.DecodeString(*req.Value)
		if err != nil {
			writeSecretError(c, http.StatusBadRequest, "新值不是有效的 Base64")
			return
		}
	default:
		writeSecretError(c, http.StatusBadRequest, "请选择文本或 Base64 格式")
		return
	}
	secret, ok := getSecret(c, client)
	if !ok {
		return
	}
	if secret.UID != req.UID || secret.ResourceVersion != req.ResourceVersion {
		writeSecretError(c, http.StatusConflict, "Secret 已变更，请重新加载后再试")
		return
	}
	if secret.Immutable != nil && *secret.Immutable {
		writeSecretError(c, http.StatusBadRequest, "此 Secret 不可变")
		return
	}
	if _, ok := secret.Data[req.Key]; !ok {
		writeSecretError(c, http.StatusBadRequest, "该键不存在")
		return
	}
	secret.Data[req.Key] = value
	updated, err := client.Update(c.Request.Context(), secret, metav1.UpdateOptions{})
	if err != nil {
		writeSecretK8sError(c, err)
		return
	}
	invalidateSecretListCache(c.Param("id"), c.Param("namespace"))
	c.JSON(http.StatusOK, summarizeSecret(updated))
}

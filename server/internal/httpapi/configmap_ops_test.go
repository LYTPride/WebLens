package httpapi

import (
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestMarshalConfigMapYAMLPreparesEditableDocument(t *testing.T) {
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "filebeat-config",
			Namespace: "train-uat",
			ManagedFields: []metav1.ManagedFieldsEntry{
				{Manager: "kube-controller-manager"},
			},
		},
		Data: map[string]string{
			"filebeat.yml": "filebeat.inputs:\n- type: container\n  paths:\n  - /var/log/containers/*.log\n",
		},
	}

	raw, err := marshalConfigMapYAML(cm)
	if err != nil {
		t.Fatalf("marshalConfigMapYAML returned error: %v", err)
	}
	text := string(raw)
	for _, want := range []string{"apiVersion: v1", "kind: ConfigMap", "name: filebeat-config", "namespace: train-uat", "filebeat.yml"} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected YAML to contain %q, got:\n%s", want, text)
		}
	}
	if strings.Contains(text, "managedFields") {
		t.Fatalf("expected managedFields to be removed, got:\n%s", text)
	}
	if len(cm.ManagedFields) == 0 {
		t.Fatalf("marshalConfigMapYAML should not mutate the original ConfigMap")
	}
}

package kubernetes

import (
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func testSecret() *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "Secret",
		"metadata": map[string]interface{}{
			"name":      "db",
			"namespace": "app",
			"annotations": map[string]interface{}{
				"kubectl.kubernetes.io/last-applied-configuration": `{"data":{"pw":"c2VjcmV0"}}`,
				"keep": "me",
			},
		},
		"type":       "Opaque",
		"data":       map[string]interface{}{"pw": "c2VjcmV0"},
		"stringData": map[string]interface{}{"pw": "secret"},
	}}
}

func TestManagedResourceStripsSecretData(t *testing.T) {
	in := testSecret()
	rs := managedResourceStatusFromObject(in, "v1/Secret", "db", "app")
	o := rs.Object.Object
	if _, ok := o["data"]; ok {
		t.Error("data leaked")
	}
	if _, ok := o["stringData"]; ok {
		t.Error("stringData leaked")
	}
	ann := rs.Object.GetAnnotations()
	if _, ok := ann["kubectl.kubernetes.io/last-applied-configuration"]; ok {
		t.Error("last-applied annotation leaked")
	}
	if ann["keep"] != "me" || rs.Object.GetName() != "db" || o["type"] != "Opaque" {
		t.Errorf("metadata/type not kept: %v", o)
	}
}

func TestManagedResourceDoesNotMutateInput(t *testing.T) {
	in := testSecret()
	_ = managedResourceStatusFromObject(in, "v1/Secret", "db", "app")
	if _, ok := in.Object["data"]; !ok {
		t.Error("input data removed")
	}
	if _, ok := in.Object["stringData"]; !ok {
		t.Error("input stringData removed")
	}
	if _, ok := in.GetAnnotations()["kubectl.kubernetes.io/last-applied-configuration"]; !ok {
		t.Error("input annotation removed")
	}
}

func TestManagedResourceLeavesNonSecretsAlone(t *testing.T) {
	cm := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "v1", "kind": "ConfigMap",
		"metadata": map[string]interface{}{"name": "c", "namespace": "app"},
		"data":     map[string]interface{}{"k": "v"},
	}}
	rs := managedResourceStatusFromObject(cm, "v1/ConfigMap", "c", "app")
	if rs.Object != cm {
		t.Error("non-Secret object should be returned as-is")
	}
	if _, ok := rs.Object.Object["data"]; !ok {
		t.Error("ConfigMap data removed")
	}
	other := &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": "example.io/v1", "kind": "Secret",
		"metadata": map[string]interface{}{"name": "x"},
		"data":     "keep",
	}}
	if redactSecret(other) != other {
		t.Error("non-core Secret kind should be untouched")
	}
}

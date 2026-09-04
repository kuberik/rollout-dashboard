package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestWriteUpstreamErrorMapsApiserverStatusToHTTP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	gr := schema.GroupResource{Group: "kuberik.com", Resource: "rollouts"}
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"forbidden is the caller's own RBAC", apierrors.NewForbidden(gr, "app", errors.New("cannot patch")), http.StatusForbidden},
		{"wrapped forbidden still maps", errorsJoin("updating rollout", apierrors.NewForbidden(gr, "app", errors.New("no"))), http.StatusForbidden},
		{"unauthorized", apierrors.NewUnauthorized("token expired"), http.StatusUnauthorized},
		{"not found is a stale page", apierrors.NewNotFound(gr, "gone"), http.StatusNotFound},
		{"conflict is a lost update", apierrors.NewConflict(gr, "app", errors.New("modified")), http.StatusConflict},
		{"anything else stays a 500", errors.New("dial tcp: connection refused"), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)
			writeUpstreamError(c, "Failed to update rollout version", tc.err)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, tc.want, rec.Body.String())
			}
			body := rec.Body.String()
			for _, s := range []string{`"error":"Failed to update rollout version"`, `"details":"`} {
				if !contains(body, s) {
					t.Fatalf("body %s lacks %s", body, s)
				}
			}
		})
	}
}

func errorsJoin(msg string, err error) error { return &wrapped{msg: msg, err: err} }

type wrapped struct {
	msg string
	err error
}

func (w *wrapped) Error() string { return w.msg + ": " + w.err.Error() }
func (w *wrapped) Unwrap() error { return w.err }

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexOf(s, sub) >= 0)
}
func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

package main

import (
	"encoding/json"
	"testing"

	envv1alpha1 "github.com/kuberik/environment-controller/api/v1alpha1"
)

// The API serves Environments as typed structs; the sites-and-waves fields
// must survive a decode/encode round trip.
func TestEnvironmentWaveFieldsRoundTrip(t *testing.T) {
	raw := `{"spec":{"environment":"prod","site":"eu-west-1","wave":2,"lockstep":true},
		"status":{"wave":{"site":"eu-west-1","wave":2,"role":"Follower","leader":"a","members":[{"environment":"prod","site":"a","wave":1}]}}}`
	var e envv1alpha1.Environment
	if err := json.Unmarshal([]byte(raw), &e); err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(e)
	var m struct {
		Spec struct {
			Site     string
			Wave     int32
			Lockstep bool
		}
		Status struct {
			Wave struct {
				Role    string
				Leader  string
				Members []struct{ Site string }
			}
		}
	}
	if err := json.Unmarshal(out, &m); err != nil {
		t.Fatal(err)
	}
	if m.Spec.Site != "eu-west-1" || m.Spec.Wave != 2 || !m.Spec.Lockstep ||
		m.Status.Wave.Role != "Follower" || m.Status.Wave.Leader != "a" || len(m.Status.Wave.Members) != 1 {
		t.Fatalf("lost fields: %s", out)
	}
}

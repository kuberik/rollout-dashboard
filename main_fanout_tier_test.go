package main

import (
	"encoding/json"
	"testing"
)

func TestCanonicalTier(t *testing.T) {
	cases := map[string]string{
		"dev": "dev", "development": "dev",
		"test": "test", "qa": "test",
		"staging": "staging", "stage": "staging", "preprod": "staging",
		"prod": "prod", "production": "prod",
		"prod-eu": "prod-eu", "": "",
	}
	for in, want := range cases {
		if got := canonicalTier(in); got != want {
			t.Errorf("canonicalTier(%q) = %q, want %q", in, got, want)
		}
	}
}

// An Environment whose spec says "production" and whose environmentInfo says
// "prod" is the same environment: its URL is the local dashboard.
func TestLocalDashboardURLsAliasNormalised(t *testing.T) {
	raw := json.RawMessage(`{"items":[{"spec":{"environment":"production"},"status":{"environmentInfos":[
		{"environment":"prod","environmentUrl":"https://kuberik.hub.example.com/x"},
		{"environment":"dev","environmentUrl":"https://kuberik.other.example.com/x"}]}}]}`)
	urls := localDashboardURLsFromEnvironments(parseEnvironments(raw))
	if len(urls) != 1 || urls[0] != "https://kuberik.hub.example.com" {
		t.Fatalf("got %v", urls)
	}
}

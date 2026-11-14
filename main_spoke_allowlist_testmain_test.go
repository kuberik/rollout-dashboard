package main

import (
	"net/url"
	"os"
	"testing"
)

// TestMain lets the legacy suite's httptest spokes (random 127.0.0.1 ports)
// through; allowlist tests call useRealSpokeAllowlist to test the real check.
func TestMain(m *testing.M) {
	spokeURLAllowedOverride = func(raw string) bool {
		u, err := url.Parse(raw)
		return err == nil && u.Hostname() == "127.0.0.1"
	}
	os.Exit(m.Run())
}

// useRealSpokeAllowlist disables the loopback override for one test and sets
// SPOKE_URL_ALLOWLIST to allow.
func useRealSpokeAllowlist(t *testing.T, allow string) {
	t.Helper()
	prev := spokeURLAllowedOverride
	spokeURLAllowedOverride = nil
	t.Cleanup(func() { spokeURLAllowedOverride = prev })
	t.Setenv(spokeAllowlistEnv, allow)
}

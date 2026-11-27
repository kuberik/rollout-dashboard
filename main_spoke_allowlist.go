package main

import (
	"log"
	"net/url"
	"os"
	"strings"
	"sync"
)

// spokeAllowlistEnv names the operator-configured trust list for spoke
// dashboards. Spoke URLs are discovered from Environment status (GitHub
// deployment statuses), which anyone able to post a deployment status can
// influence; viewer credentials (Bearer token, gh_token cookie) are therefore
// only ever sent to origins listed here. Fail closed: unset => no spokes.
//
// Format: comma-separated origins, scheme://host[:port]. The host may be a
// suffix wildcard, e.g. https://*.example.com (matches a.example.com and
// a.b.example.com, never example.com itself). http:// is only accepted when
// listed explicitly. Matching is on the parsed origin (scheme, lowercased host
// without trailing dot, effective port), never on a string prefix.
const spokeAllowlistEnv = "SPOKE_URL_ALLOWLIST"

type spokeOriginRule struct {
	scheme   string
	host     string // lowercased, no trailing dot; for wildcard rules, the suffix after "*."
	wildcard bool
	port     string // effective port
}

func defaultPort(scheme string) string {
	switch scheme {
	case "https":
		return "443"
	case "http":
		return "80"
	}
	return ""
}

func normalizeHost(h string) string {
	return strings.TrimRight(strings.ToLower(h), ".")
}

// parseSpokeAllowlist parses once per distinct raw value (cached, so the
// malformed-entry warnings fire once, not on every request).
func parseSpokeAllowlist(raw string) []spokeOriginRule {
	if v, ok := spokeAllowlistCache.Load(raw); ok {
		return v.([]spokeOriginRule)
	}
	rules := parseSpokeAllowlistUncached(raw)
	v, _ := spokeAllowlistCache.LoadOrStore(raw, rules)
	return v.([]spokeOriginRule)
}

var spokeAllowlistCache sync.Map // raw string -> []spokeOriginRule

// droppedSpokeLogged dedupes the "dropping discovered spoke" line per URL.
var droppedSpokeLogged sync.Map

func parseSpokeAllowlistUncached(raw string) []spokeOriginRule {
	var rules []spokeOriginRule
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		u, err := url.Parse(entry)
		if err != nil || u.User != nil || u.Host == "" || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
			log.Printf("spoke allowlist: ignoring malformed %s entry %q", spokeAllowlistEnv, entry)
			continue
		}
		scheme := strings.ToLower(u.Scheme)
		if scheme != "https" && scheme != "http" {
			log.Printf("spoke allowlist: ignoring %s entry %q (scheme must be http or https)", spokeAllowlistEnv, entry)
			continue
		}
		host := normalizeHost(u.Hostname())
		r := spokeOriginRule{scheme: scheme, port: u.Port()}
		if r.port == "" {
			r.port = defaultPort(scheme)
		}
		if strings.HasPrefix(host, "*.") {
			r.wildcard = true
			host = host[2:]
		}
		if host == "" || strings.Contains(host, "*") {
			log.Printf("spoke allowlist: ignoring malformed %s entry %q", spokeAllowlistEnv, entry)
			continue
		}
		r.host = host
		rules = append(rules, r)
	}
	return rules
}

var spokeAllowlistUnsetOnce sync.Once

// spokeURLAllowedOverride is a test seam only (nil in production). The legacy
// suite registers httptest spokes on random loopback ports, which no static
// allowlist can name; its TestMain installs a loopback-only override, and the
// allowlist's own tests nil it to exercise the real check.
var spokeURLAllowedOverride func(rawURL string) bool

// spokeURLAllowed reports whether rawURL's origin is on the operator allowlist.
func spokeURLAllowed(rawURL string) bool {
	if spokeURLAllowedOverride != nil {
		return spokeURLAllowedOverride(rawURL)
	}
	rules := parseSpokeAllowlist(os.Getenv(spokeAllowlistEnv))
	if len(rules) == 0 {
		spokeAllowlistUnsetOnce.Do(func() {
			log.Printf("spoke allowlist: %s is unset or empty — discovered spoke dashboards are IGNORED (fail closed) so viewer credentials are never sent to URLs taken from Environment status. Set it to a comma-separated list of origins, e.g. https://spoke.example.com", spokeAllowlistEnv)
		})
		return false
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" || u.User != nil {
		return false
	}
	scheme := strings.ToLower(u.Scheme)
	host := normalizeHost(u.Hostname())
	port := u.Port()
	if port == "" {
		port = defaultPort(scheme)
	}
	for _, r := range rules {
		if r.scheme != scheme || r.port != port {
			continue
		}
		if r.wildcard {
			if strings.HasSuffix(host, "."+r.host) && len(host) > len(r.host)+1 {
				return true
			}
		} else if host == r.host {
			return true
		}
	}
	return false
}

// filterAllowedSpokeURLs drops every URL whose origin is not allowlisted.
func filterAllowedSpokeURLs(urls []string) []string {
	var out []string
	for _, u := range urls {
		if spokeURLAllowed(u) {
			out = append(out, u)
		} else {
			base := dashboardBaseURL(u)
			if _, seen := droppedSpokeLogged.LoadOrStore(base, true); !seen {
				log.Printf("spoke allowlist: dropping discovered spoke %q (origin not in %s); logged once per process", base, spokeAllowlistEnv)
			}
		}
	}
	return out
}

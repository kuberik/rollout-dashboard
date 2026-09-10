package githubapp

import (
	"regexp"
	"strings"
)

// repoURLPattern extracts owner/repo from a GitHub URL in any common form:
// https://github.com/owner/repo, https://github.com/owner/repo.git,
// git@github.com:owner/repo.git, or a URL with a trailing /tree/<branch>
// (or any other) tail. The repo group is [^/]+ — not [^/.]+ — so a dotted
// repo name (e.g. "foo.js") survives; a literal ".git" suffix is trimmed
// explicitly below instead of being excluded character-by-character, and a
// /tree/<branch> tail is discarded simply because the group stops at the
// next "/" either way.
var repoURLPattern = regexp.MustCompile(`github\.com[/:]([^/]+)/([^/]+)`)

// ParseRepoURL extracts owner/repo from a GitHub URL in any common form
// (https://github.com/owner/repo, https://github.com/owner/repo.git,
// git@github.com:owner/repo.git). Returns ok=false if the URL isn't a
// recognizable GitHub repo URL.
func ParseRepoURL(url string) (owner, repo string, ok bool) {
	m := repoURLPattern.FindStringSubmatch(url)
	if m == nil {
		return "", "", false
	}
	return m[1], strings.TrimSuffix(m[2], ".git"), true
}

// NormalizedRepoKey builds the canonical, case-insensitive "owner/repo"
// comparison key used to match a requested :owner/:repo against the repos
// ParseRepoURL extracts from rollout status.source values — lowercase, dots
// preserved, so "Owner/Foo.js" and "owner/foo.js" compare equal. This is the
// one repo-normalisation rule the GitHub pull-request endpoint uses on the Go
// side; the frontend's normalizeSource (lib/version-utils.ts) applies the
// equivalent rule (lowercase, strip trailing .git, ignore /tree/<branch>
// tails, keep dots) independently, since it normalises full source strings
// rather than already-split owner/repo pairs.
func NormalizedRepoKey(owner, repo string) string {
	return strings.ToLower(owner) + "/" + strings.ToLower(repo)
}

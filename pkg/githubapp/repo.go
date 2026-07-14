package githubapp

import "regexp"

var repoURLPattern = regexp.MustCompile(`github\.com[/:]([^/]+)/([^/.]+)`)

// ParseRepoURL extracts owner/repo from a GitHub URL in any common form
// (https://github.com/owner/repo, https://github.com/owner/repo.git,
// git@github.com:owner/repo.git). Returns ok=false if the URL isn't a
// recognizable GitHub repo URL.
func ParseRepoURL(url string) (owner, repo string, ok bool) {
	m := repoURLPattern.FindStringSubmatch(url)
	if m == nil {
		return "", "", false
	}
	return m[1], m[2], true
}

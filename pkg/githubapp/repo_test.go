package githubapp

import "testing"

func TestParseRepoURL(t *testing.T) {
	cases := []struct {
		name      string
		url       string
		wantOwner string
		wantRepo  string
		wantOK    bool
	}{
		{"https URL", "https://github.com/owner/repo", "owner", "repo", true},
		{"https URL with .git", "https://github.com/owner/repo.git", "owner", "repo", true},
		{"ssh URL", "git@github.com:owner/repo.git", "owner", "repo", true},
		{
			// A repo name containing a dot must survive whole — the old
			// regex ([^/.]+) stopped at the first dot and truncated this to
			// "foo", silently mis-scoping every call keyed on it.
			"dotted repo name", "https://github.com/owner/foo.js", "owner", "foo.js", true,
		},
		{"dotted repo name with .git suffix", "https://github.com/owner/foo.js.git", "owner", "foo.js", true},
		{"URL with /tree/<branch> tail", "https://github.com/owner/repo/tree/main", "owner", "repo", true},
		{"dotted repo name with /tree/<branch> tail", "https://github.com/owner/foo.js/tree/main", "owner", "foo.js", true},
		{"not a github URL", "https://gitlab.com/owner/repo", "", "", false},
		{"garbage", "not a url", "", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			owner, repo, ok := ParseRepoURL(tc.url)
			if ok != tc.wantOK || owner != tc.wantOwner || repo != tc.wantRepo {
				t.Fatalf("ParseRepoURL(%q) = (%q, %q, %v), want (%q, %q, %v)",
					tc.url, owner, repo, ok, tc.wantOwner, tc.wantRepo, tc.wantOK)
			}
		})
	}
}

func TestNormalizedRepoKey(t *testing.T) {
	if got, want := NormalizedRepoKey("Owner", "Foo.js"), "owner/foo.js"; got != want {
		t.Fatalf("NormalizedRepoKey = %q, want %q", got, want)
	}
	a := NormalizedRepoKey("Owner", "Repo")
	b := NormalizedRepoKey("owner", "repo")
	if a != b {
		t.Fatalf("NormalizedRepoKey should be case-insensitive: %q != %q", a, b)
	}
}

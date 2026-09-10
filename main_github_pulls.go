package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/go-github/v88/github"
	envv1alpha1 "github.com/kuberik/environment-controller/api/v1alpha1"
	rolloutv1alpha1 "github.com/kuberik/rollout-controller/api/v1alpha1"
	"github.com/kuberik/rollout-dashboard/pkg/auth"
	"github.com/kuberik/rollout-dashboard/pkg/githubapp"
	"github.com/kuberik/rollout-dashboard/pkg/kubernetes"
)

// maxContainedInCommits bounds the "commits since merge" walk. A PR merged
// long enough ago that 300 commits have landed on its base branch since is
// almost certainly baked into every build that matters; past this point the
// frontend falls back to a created-vs-merged-time heuristic per release
// rather than this handler ever fetching an unbounded history.
const maxContainedInCommits = 300

// handleGitHubPullRequest serves GET /api/github/pulls/:owner/:repo/:number.
// See the design doc (polish-revisions-pass-6) "Backend" section: the PR page
// asks "is my PR in yet" per service, and this is the one GitHub-backed fact
// it needs — a PR's merge state and, once merged, the set of commit shas on
// its base branch since the merge (a build "contains" the PR when its
// revision is in that set).
//
// Scoped to the cluster: this is not a generic GitHub proxy. A request for a
// repo that no rollout the viewing user can see deploys gets a 404, exactly
// like a PR that does not exist — never a distinguishing error that would let
// someone probe which repos this cluster's rollouts point at.
//
// Auth mirrors GET /rollouts/:namespace/:name/commits: the viewing user's own
// GitHub token (gh_token cookie) through githubapp.UserClient and
// githubcache, never the dashboard's own installation identity, so PR data a
// user cannot see on GitHub never leaks through this endpoint either. Unlike
// the commits endpoint (which distinguishes 403 github_no_access from 404),
// this endpoint collapses "GitHub says no" into the same 404 the cluster-scope
// check uses — a PR page has nothing useful to say beyond "not found" either
// way, and a flat 404 avoids confirming a private repo's existence.
func handleGitHubPullRequest(c *gin.Context) {
	owner := c.Param("owner")
	repo := c.Param("repo")
	number, err := strconv.Atoi(c.Param("number"))
	if err != nil || number <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid pull request number"})
		return
	}

	// This response is scoped to the viewing user's own GitHub access and
	// must never land in a shared cache; it is also a live "is it merged /
	// does it have a new commit yet" question, so never conditionally
	// revalidated either — always no-store (unlike the commits endpoint's
	// sha-range compare, there is no immutable sub-case here: the PR's own
	// merge state is exactly what's being asked).
	c.Header("Cache-Control", "private, no-store")

	k8sClient, ok := getK8sReadClient(c)
	if !ok {
		return
	}

	visibleSources, err := visibleGitHubSources(c, k8sClient)
	if err != nil {
		log.Printf("Error checking repository visibility for %s/%s: %v", owner, repo, err)
		writeUpstreamError(c, "Failed to check repository visibility", err)
		return
	}
	if !visibleSources[githubapp.NormalizedRepoKey(owner, repo)] {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
		return
	}

	token := readCookie(c, githubTokenCookie)
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "github_not_connected"})
		return
	}
	ghClient, err := githubapp.UserClient(token)
	if err != nil {
		writeUpstreamError(c, "Failed to build GitHub client", err)
		return
	}

	pr, _, err := ghClient.PullRequests.Get(context.Background(), owner, repo, number)
	if err != nil {
		var ghErr *github.ErrorResponse
		if errors.As(err, &ghErr) && ghErr.Response != nil {
			switch ghErr.Response.StatusCode {
			case http.StatusNotFound, http.StatusForbidden:
				// A user with no access to the repo/PR gets the same answer
				// as "doesn't exist" — never distinguished from it.
				c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
				return
			case http.StatusUnauthorized:
				// Token revoked — drop it so the UI reconnects, same as the
				// commits endpoint.
				c.SetCookie(githubTokenCookie, "", -1, "/", "", true, true)
				c.JSON(http.StatusUnauthorized, gin.H{"error": "github_not_connected"})
				return
			}
		}
		log.Printf("Error fetching pull request %s/%s#%d: %v", owner, repo, number, err)
		c.JSON(http.StatusBadGateway, gin.H{
			"error":   "Failed to fetch pull request from GitHub",
			"details": err.Error(),
		})
		return
	}

	state := pr.GetState() // "open" or "closed", per the GitHub API
	if pr.MergedAt != nil {
		state = "merged"
	}

	var mergedAt *string
	if pr.MergedAt != nil {
		s := pr.MergedAt.Format(time.RFC3339)
		mergedAt = &s
	}

	base := ""
	if pr.Base != nil {
		base = pr.Base.GetRef()
	}

	var mergeCommitSha *string
	containedIn := []string{}
	containedInAll := false

	if state == "merged" && pr.MergedAt != nil {
		sha := pr.GetMergeCommitSHA()
		if sha != "" {
			mergeCommitSha = &sha
		}
		shas, cutAt300, cerr := commitsSinceMerge(context.Background(), ghClient, owner, repo, base, pr.MergedAt.Time)
		if cerr != nil {
			log.Printf("Error listing commits since merge for %s/%s#%d: %v", owner, repo, number, cerr)
			c.JSON(http.StatusBadGateway, gin.H{
				"error":   "Failed to fetch commit range from GitHub",
				"details": cerr.Error(),
			})
			return
		}
		// The merge commit itself is always "contained" — union it in even
		// though a normal merge/squash/rebase commit lands on the base
		// branch with a date >= mergedAt and so is already picked up by the
		// since= walk below; this is the belt for that suspenders.
		if sha != "" {
			found := false
			for _, s := range shas {
				if s == sha {
					found = true
					break
				}
			}
			if !found {
				shas = append([]string{sha}, shas...)
				if len(shas) > maxContainedInCommits {
					shas = shas[:maxContainedInCommits]
				}
			}
		}
		containedIn = shas
		containedInAll = cutAt300
	}

	c.JSON(http.StatusOK, gin.H{
		"number":         pr.GetNumber(),
		"title":          pr.GetTitle(),
		"htmlUrl":        pr.GetHTMLURL(),
		"author":         pr.GetUser().GetLogin(),
		"state":          state,
		"mergedAt":       mergedAt,
		"mergeCommitSha": mergeCommitSha,
		"base":           base,
		"containedIn":    containedIn,
		"containedInAll": containedInAll,
	})
}

// commitsSinceMerge lists the shas on repo's base branch since the PR merged,
// via GET /repos/{owner}/{repo}/commits?sha=<base>&since=<mergedAt>, paginated
// at 100/page up to maxContainedInCommits total. cutAt300 reports whether
// there were more commits beyond that cap — i.e. whether containedIn is a
// complete answer or a truncated one the frontend must reason about
// differently (see the design doc's per-release created-vs-merged fallback).
func commitsSinceMerge(ctx context.Context, ghClient *github.Client, owner, repo, base string, since time.Time) (shas []string, cutAt300 bool, err error) {
	opts := &github.CommitsListOptions{
		SHA:         base,
		Since:       since,
		ListOptions: github.ListOptions{PerPage: 100},
	}
	seen := map[string]bool{}
	for {
		commits, resp, cerr := ghClient.Repositories.ListCommits(ctx, owner, repo, opts)
		if cerr != nil {
			return nil, false, cerr
		}
		for _, commit := range commits {
			sha := commit.GetSHA()
			if sha == "" || seen[sha] {
				continue
			}
			seen[sha] = true
			shas = append(shas, sha)
		}
		if len(shas) >= maxContainedInCommits {
			if len(shas) > maxContainedInCommits {
				shas = shas[:maxContainedInCommits]
				cutAt300 = true
			} else if resp.NextPage != 0 {
				cutAt300 = true
			}
			break
		}
		if resp.NextPage == 0 {
			break
		}
		opts.Page = resp.NextPage
	}
	if shas == nil {
		shas = []string{}
	}
	return shas, cutAt300, nil
}

// visibleGitHubSources returns the set of normalised "owner/repo" keys — see
// githubapp.NormalizedRepoKey — for every distinct rollout status.source the
// requesting user can see, across the hub AND every discovered spoke. This
// is deliberately the SAME visibility trim and the SAME fan-in fanOutRollouts
// (main_fanout.go) that GET /api/rollouts applies, reused rather than
// duplicated: a repo the user cannot themselves `list rollouts` for in any
// namespace, on any cluster, can never be probed through the PR endpoint.
func visibleGitHubSources(c *gin.Context, k8sClient *kubernetes.Client) (map[string]bool, error) {
	ctx := c.Request.Context()

	rollouts, err := k8sClient.GetRolloutsAllNamespaces(ctx)
	if err != nil {
		return nil, err
	}

	nsSet := map[string]struct{}{}
	for _, r := range rollouts.Items {
		nsSet[r.Namespace] = struct{}{}
	}
	namespaces := make([]string, 0, len(nsSet))
	for ns := range nsSet {
		namespaces = append(namespaces, ns)
	}
	allowedNS, err := kubernetes.AllowedNamespaces(c, namespaces)
	if err != nil {
		return nil, err
	}
	rollouts.Items = kubernetes.FilterByNamespace(rollouts.Items, func(r rolloutv1alpha1.Rollout) string { return r.Namespace }, allowedNS)

	sources := map[string]bool{}
	addSources := func(items []rolloutv1alpha1.Rollout) {
		for _, r := range items {
			if r.Status.Source == nil || *r.Status.Source == "" {
				continue
			}
			owner, repo, ok := githubapp.ParseRepoURL(*r.Status.Source)
			if !ok {
				continue
			}
			sources[githubapp.NormalizedRepoKey(owner, repo)] = true
		}
	}
	addSources(rollouts.Items)

	// Already serving as a fan-out leg (a hub calling a spoke) — don't fan
	// out again, matching /api/rollouts' own cycle guard (fanoutHeader).
	if c.GetHeader(fanoutHeader) != "" {
		return sources, nil
	}

	envs, err := k8sClient.GetEnvironmentsAllNamespaces(ctx)
	if err != nil {
		// Spoke discovery is best-effort — a cluster that can't list
		// Environments still answers for its own local rollouts.
		log.Printf("Error fetching environments for PR-endpoint spoke discovery: %v", err)
		return sources, nil
	}
	envs.Items = kubernetes.FilterByNamespace(envs.Items, func(e envv1alpha1.Environment) string { return e.Namespace }, allowedNS)

	localURL := localDashboardURL(c)
	token := auth.GetTokenFromContext(c)
	localData := map[string]json.RawMessage{
		"rollouts":     marshalToRaw(rollouts),
		"environments": marshalToRaw(envs),
	}
	merged, _, _ := fanOutRollouts(ctx, localData, localURL, token)

	if raw, ok := merged["rollouts"]; ok && len(raw) > 0 {
		var mergedRollouts rolloutv1alpha1.RolloutList
		if uerr := json.Unmarshal(raw, &mergedRollouts); uerr == nil {
			addSources(mergedRollouts.Items)
		}
	}
	return sources, nil
}

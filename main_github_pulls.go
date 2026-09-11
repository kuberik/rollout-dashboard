package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
		// The repo itself is not one this cluster deploys — this is not a
		// GitHub secret (the frontend's palette already lists every source
		// repo it knows about), so it is safe to say so distinctly from "the
		// PR/repo doesn't exist on GitHub" below.
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "scope": "repo"})
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
				// The repo IS one this cluster deploys (we already passed the
				// cluster-scope check above) — GitHub itself says this PR
				// number doesn't exist, or the viewing user can't see it. A
				// user with no access gets the same answer as "doesn't
				// exist", never distinguished from it, but the SCOPE is
				// distinguished from the cluster-scope 404 above so the
				// frontend can print "wrong PR number" instead of "wrong
				// repo".
				c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "scope": "pr"})
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

	var openedAt *string
	if pr.CreatedAt != nil {
		s := pr.CreatedAt.Format(time.RFC3339)
		openedAt = &s
	}
	var headSha *string
	if pr.Head != nil && pr.Head.SHA != nil {
		headSha = pr.Head.SHA
	}
	var changedFiles *int
	if pr.ChangedFiles != nil {
		changedFiles = pr.ChangedFiles
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

	// checks: one call to repos/{o}/{r}/commits/{sha}/check-runs on the merge
	// sha (merged PRs — that's the commit that actually bakes) or the head
	// sha otherwise (open/closed-unmerged — the PR's own latest commit). A
	// failure to fetch check-runs is not fatal to the rest of this response
	// — "none" is a safe, honest answer when GitHub can't tell us, logged but
	// never turned into a 502 for facts the caller already has.
	checkSHA := ""
	if mergeCommitSha != nil && *mergeCommitSha != "" {
		checkSHA = *mergeCommitSha
	} else if headSha != nil && *headSha != "" {
		checkSHA = *headSha
	}
	checks := gin.H{"state": "none", "total": 0, "failed": 0, "url": nil}
	if checkSHA != "" {
		runs, _, cerr := ghClient.Checks.ListCheckRunsForRef(context.Background(), owner, repo, checkSHA, nil)
		if cerr != nil {
			log.Printf("Error fetching check-runs for %s/%s@%s: %v", owner, repo, checkSHA, cerr)
		} else {
			checks = summarizeCheckRuns(runs.CheckRuns, owner, repo, checkSHA)
		}
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
		"checks":         checks,
		// Open-PR facts (item 8): "is my PR in yet" has no build-pipeline
		// answer at all while the PR is still open, so the page prints these
		// instead — created_at/head.sha/changed_files, straight off the same
		// `pulls/{n}` response, no second GitHub call.
		"openedAt":     openedAt,
		"headSha":      headSha,
		"changedFiles": changedFiles,
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

// summarizeCheckRuns reduces a commit's check-runs to the one-state answer
// the PR page prints: "none" when there are no check-runs at all (the repo
// doesn't use them, or the sha hasn't been checked), "pending" when any run
// hasn't completed yet (that outranks a partial failure — the final verdict
// isn't in), "failure" when every run has completed and at least one did not
// succeed, else "success". `url` is a synthesized deep link to GitHub's own
// commit-checks tab — the API has no single "see all checks" URL on the
// list response, only a per-run HTMLURL.
func summarizeCheckRuns(runs []*github.CheckRun, owner, repo, sha string) gin.H {
	if len(runs) == 0 {
		return gin.H{"state": "none", "total": 0, "failed": 0, "url": nil}
	}
	total := len(runs)
	failed := 0
	pending := false
	for _, r := range runs {
		if r.GetStatus() != "completed" {
			pending = true
			continue
		}
		switch r.GetConclusion() {
		case "failure", "timed_out", "cancelled", "action_required", "startup_failure":
			failed++
		}
	}
	state := "success"
	switch {
	case pending:
		state = "pending"
	case failed > 0:
		state = "failure"
	}
	return gin.H{
		"state":  state,
		"total":  total,
		"failed": failed,
		"url":    fmt.Sprintf("https://github.com/%s/%s/commit/%s/checks", owner, repo, sha),
	}
}

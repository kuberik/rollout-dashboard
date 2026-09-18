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
	// ⭐ "WE CANNOT ANSWER THIS", WHICH IS NOT THE SAME AS `containedInAll`.
	// `containedInAll` means the walk RAN and hit the 300-commit cap, so the
	// list is real but partial. This means the list is not evidence about the
	// deployed fleet at all. Two causes, below: the walk failed, or it ran
	// against a branch nothing deploys from.
	containedInUnknown := false

	if state == "merged" && pr.MergedAt != nil {
		sha := pr.GetMergeCommitSHA()
		if sha != "" {
			mergeCommitSha = &sha
		}
		// ⭐ THE DEPLOY BRANCH, NOT THE PR'S BASE. A stacked PR merges into
		// another feature branch — caffeinelabs/app#8864 merged
		// `giorgio/agent-feedback-model-ai` into `giorgio/agent-feedback-model`
		// — while every rollout is built from the repo's DEFAULT branch. Asking
		// about the PR's own base answered a question nobody had: first it
		// produced false rollbacks, then an honest but useless "unknown".
		//
		// The default branch is the one the fleet actually deploys, so it is the
		// one worth asking about, for a stacked PR and an ordinary one alike.
		deployBranch := base
		if pr.Base != nil && pr.Base.Repo != nil {
			if def := pr.Base.Repo.GetDefaultBranch(); def != "" {
				deployBranch = def
			}
		}
		shas, truncated, onBranch, cerr := commitsCarryingMerge(
			context.Background(), ghClient, owner, repo, pr.GetMergeCommitSHA(), deployBranch,
		)
		if cerr != nil {
			// ⛔ NOT A 502. This walk is an ENRICHMENT — it answers "which builds
			// carry this PR" — and the rest of the response is already in hand.
			// Failing the whole page for it breaks the rule the `checks` block
			// below states in its own comment.
			//
			// ⚠️ `containedInUnknown` NOW MEANS ONLY THIS: we asked and could not
			// get an answer. It used to also cover "the PR is stacked", which is
			// no longer unknowable — see `commitsCarryingMerge`. Absence from an
			// unknown set proves nothing, so no cell may read it as a rollback.
			log.Printf("Error comparing %s..%s for %s/%s#%d (containment unknown): %v",
				pr.GetMergeCommitSHA(), deployBranch, owner, repo, number, cerr)
			shas = []string{}
			truncated = true
			containedInUnknown = true
		} else if !onBranch {
			// ⭐ A REAL ANSWER, NOT AN ABSENCE OF ONE. The merge commit is not
			// reachable from the deploy branch, so the stack it is part of has
			// not landed yet and NOTHING built from that branch can carry the
			// change. An authoritative empty set says exactly that — every cell
			// reads "not built", which is true — and it is emphatically not
			// `containedInUnknown`.
			log.Printf("Change %s for %s/%s#%d has not reached %s yet",
				pr.GetMergeCommitSHA(), owner, repo, number, deployBranch)
		}
		// ⭐ THE MERGE COMMIT ITSELF, ALWAYS. `compare/{mergeSha}...{branch}`
		// returns the commits AFTER the merge commit and never the commit
		// itself, so without this a build cut at exactly that sha would read
		// "not built" — the one revision we are certain carries the change.
		// (The previous clock-based walk needed this too, for the same reason;
		// dropping it in the rewrite is what the "want just the merge sha" test
		// caught.)
		if sha := pr.GetMergeCommitSHA(); sha != "" {
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
					truncated = true
				}
			}
		}
		containedIn = shas
		containedInAll = truncated
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
		"number":             pr.GetNumber(),
		"title":              pr.GetTitle(),
		"htmlUrl":            pr.GetHTMLURL(),
		"author":             pr.GetUser().GetLogin(),
		"state":              state,
		"mergedAt":           mergedAt,
		"mergeCommitSha":     mergeCommitSha,
		"base":               base,
		"containedIn":        containedIn,
		"containedInAll":     containedInAll,
		"containedInUnknown": containedInUnknown,
		"checks":             checks,
		// Open-PR facts (item 8): "is my PR in yet" has no build-pipeline
		// answer at all while the PR is still open, so the page prints these
		// instead — created_at/head.sha/changed_files, straight off the same
		// `pulls/{n}` response, no second GitHub call.
		"openedAt":     openedAt,
		"headSha":      headSha,
		"changedFiles": changedFiles,
	})
}

// ⭐ CONTAINMENT BY ANCESTRY, NOT BY CLOCK — AND AGAINST THE BRANCH THE FLEET
// ACTUALLY DEPLOYS. (2026-09-18, from the human, looking at a stacked PR whose
// prod cells all read "release status unknown": "it looks better but still
// weird that prod doesn't have some data. can we really not do better?")
//
// We can, and this is how much better. `compare/{mergeSha}...{branch}` answers
// BOTH questions this endpoint has, in ONE call:
//
//	status "ahead"     — the merge commit IS an ancestor of the branch, and
//	                     `commits` is EXACTLY its descendants there.
//	status "diverged"  — it is not on that branch at all.
//	status "identical" — the branch head IS the merge commit.
//
// ⛔ WHY THIS REPLACES `commitsSinceMerge` *IN THIS HANDLER*. (It stays for the
// bare-sha endpoint in `main_github_commit.go`, which already walks the DEFAULT
// branch — that endpoint had this right all along and the pulls handler was the
// odd one out.) That walked `commits?sha=<base>
// &since=<mergedAt>` — a CLOCK proxy for ancestry, against the PR's OWN base.
// Both halves were wrong for a stacked PR and the second was wrong for
// everyone:
//
//	· THE BRANCH. A stacked PR's base is another feature branch, which nothing
//	  is ever built from, so the walk answered about a branch no build exists
//	  on. That is what produced the false rollbacks, and then the honest but
//	  useless "unknown" that replaced them.
//	· THE CLOCK. `since=mergedAt` includes every commit on the branch after
//	  that instant whether or not it descends from the merge — so a build cut
//	  from a commit that does NOT carry the change could still be reported as
//	  carrying it. Ancestry cannot make that mistake.
//
// Measured on caffeinelabs/app#8864, the reported case: base
// `giorgio/agent-feedback-model`, default `main`, merge commit 75d69ad. The
// compare against `main` returns status `ahead` with 24 commits — the change
// has been on the deploy branch for hours. The old walk could not see that and
// gave up.
//
// ⚠️ TRUNCATION IS REPORTED, NOT GUESSED. GitHub caps `commits` at 250 per
// response while `total_commits` reports the true size, so a range past the cap
// is known to be short rather than silently partial — the same bit `cutAt300`
// carried, now sourced from the API instead of from a page counter.
func commitsCarryingMerge(
	ctx context.Context,
	ghClient *github.Client,
	owner, repo, mergeSha, branch string,
) (shas []string, truncated bool, onBranch bool, err error) {
	cmp, _, cerr := ghClient.Repositories.CompareCommits(
		ctx, owner, repo, mergeSha, branch, &github.ListOptions{PerPage: 250},
	)
	if cerr != nil {
		return nil, false, false, cerr
	}
	switch cmp.GetStatus() {
	case "ahead", "identical":
		// The merge commit is reachable from the branch.
	default:
		// "diverged" (and anything unexpected): the change has not reached this
		// branch. That is a REAL answer — nothing built from it carries the
		// change — and must not be dressed up as "unknown".
		return []string{}, false, false, nil
	}
	for _, c := range cmp.Commits {
		if sha := c.GetSHA(); sha != "" {
			shas = append(shas, sha)
		}
	}
	if cmp.GetTotalCommits() > len(shas) {
		truncated = true
	}
	if len(shas) > maxContainedInCommits {
		shas = shas[:maxContainedInCommits]
		truncated = true
	}
	if shas == nil {
		shas = []string{}
	}
	return shas, truncated, true, nil
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

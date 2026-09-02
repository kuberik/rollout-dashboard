// Package githubapp authenticates GitHub API calls as the *viewing user* via
// the GitHub App's user-authorization (user-to-server) flow, rather than as the
// app installation. This means commit data the dashboard surfaces is scoped to
// what each user can actually see on GitHub — a user with no access to a repo
// gets a 404, never someone else's private history.
//
// The app itself is identified by GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET.
// Tokens are non-expiring user access tokens (the app must have token expiry
// disabled) and are held in an httpOnly cookie by the caller, never server-side.
package githubapp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/go-github/v88/github"

	"github.com/kuberik/rollout-dashboard/pkg/githubcache"
)

const (
	githubAuthorizeURL = "https://github.com/login/oauth/authorize"
	githubTokenURL     = "https://github.com/login/oauth/access_token"
)

// Configured reports whether the GitHub App user-OAuth env vars are set.
func Configured() bool {
	return os.Getenv("GITHUB_APP_CLIENT_ID") != "" && os.Getenv("GITHUB_APP_CLIENT_SECRET") != ""
}

func clientID() string     { return os.Getenv("GITHUB_APP_CLIENT_ID") }
func clientSecret() string { return os.Getenv("GITHUB_APP_CLIENT_SECRET") }

// AuthorizeURL builds the GitHub user-authorization redirect the browser is sent
// to when the user clicks "Connect GitHub". redirectURI must match a callback
// URL registered on the GitHub App; state is an opaque CSRF token echoed back to
// the callback. GitHub App user tokens derive access from the app's permissions
// intersected with the user's — no OAuth scope param is used.
func AuthorizeURL(redirectURI, state string) string {
	q := url.Values{}
	q.Set("client_id", clientID())
	q.Set("redirect_uri", redirectURI)
	q.Set("state", state)
	return githubAuthorizeURL + "?" + q.Encode()
}

// ExchangeCode swaps the authorization code from the callback for a user access
// token, authenticating the exchange with the app's client id + secret.
func ExchangeCode(ctx context.Context, code, redirectURI string) (string, error) {
	form := url.Values{}
	form.Set("client_id", clientID())
	form.Set("client_secret", clientSecret())
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, githubTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	httpClient := &http.Client{Timeout: 15 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var body struct {
		AccessToken      string `json:"access_token"`
		TokenType        string `json:"token_type"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("failed to decode token response: %w", err)
	}
	if body.Error != "" {
		return "", fmt.Errorf("github token exchange failed: %s (%s)", body.Error, body.ErrorDescription)
	}
	if body.AccessToken == "" {
		return "", fmt.Errorf("github token exchange returned no access token")
	}
	return body.AccessToken, nil
}

// UserClient returns a github client that acts as the user who owns token.
//
// ⭐ EVERY GET THIS CLIENT MAKES IS CONDITIONAL. `githubcache.Shared()` is the
// client's transport, so a repeat question carries the stored `ETag` and comes
// back `304 Not Modified` — which GitHub does not charge to the rate limit —
// instead of re-downloading a comparison the dashboard already has.
//
// ⚠️ THE ORDER OF THESE TWO OPTIONS IS THE SECURITY PROPERTY, not a style
// choice. go-github's `newClient` installs `WithTransport` first and then wraps
// it with the token setter, so the cache sees each request WITH its final
// `Authorization` header and partitions on it. A cache placed above the auth
// layer would file every user's private answers under one key. See the package
// comment on `pkg/githubcache`.
func UserClient(token string) (*github.Client, error) {
	return github.NewClient(userClientOptions(token)...)
}

// userClientOptions is the option list UserClient is built from, split out so a
// test can append `WithURLs` and exercise the REAL chain against a stub server
// rather than a hand-rebuilt copy of it.
func userClientOptions(token string) []github.ClientOptionsFunc {
	return []github.ClientOptionsFunc{
		github.WithTransport(githubcache.Shared()),
		github.WithAuthToken(token),
	}
}

// AuthenticatedUser looks up the login + avatar for a token, used to render the
// connected identity and to validate that a stored token is still good.
type AuthenticatedUser struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatarUrl"`
}

// CurrentUser calls /user with the token. Returns an error if the token is
// invalid/revoked, which the caller treats as "not connected".
func CurrentUser(ctx context.Context, token string) (*AuthenticatedUser, error) {
	client, err := UserClient(token)
	if err != nil {
		return nil, err
	}
	u, _, err := client.Users.Get(ctx, "")
	if err != nil {
		return nil, err
	}
	return &AuthenticatedUser{Login: u.GetLogin(), AvatarURL: u.GetAvatarURL()}, nil
}

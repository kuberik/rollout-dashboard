package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

// writeJSONWithETag serializes payload once, computes a strong ETag from
// those bytes, and either answers 304 (empty body) when it matches the
// request's If-None-Match, or 200 with the body and the ETag header set.
//
// Cache-Control is always "private, no-cache": the browser must revalidate
// on every request (this data changes on its own, out from under any client)
// but MAY skip re-downloading the body when the ETag still matches — turning
// a same-data poll (PERF-2026-09-04 finding #9: every open tab re-polls
// /api/rollouts every 5-15s) into a 304 with zero response bytes instead of
// re-sending the full payload every time.
//
// Deliberately only on the two heaviest, most-polled JSON routes (list +
// detail) per PERF-2026-09-04 §C.5 — not a general replacement for c.JSON.
// The ETag is computed from the plain JSON bytes, before gzip — gzip
// (main.go's gzip.Gzip middleware) wraps the ResponseWriter and compresses
// whatever writeJSONWithETag writes, so the ETag correctly stays the same
// regardless of whether a given client negotiates gzip.
func writeJSONWithETag(c *gin.Context, status int, payload interface{}) {
	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Failed to marshal JSON for ETag response: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "Failed to encode response",
			"details": err.Error(),
		})
		return
	}

	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:]) + `"`

	c.Header("Cache-Control", "private, no-cache")
	c.Header("ETag", etag)

	if match := c.GetHeader("If-None-Match"); match != "" && etagMatches(match, etag) {
		c.Status(http.StatusNotModified)
		return
	}

	c.Data(status, "application/json; charset=utf-8", body)
}

// etagMatches supports both a single If-None-Match value and the
// comma-separated list form the HTTP spec allows, including "*".
func etagMatches(ifNoneMatch, etag string) bool {
	if ifNoneMatch == "*" {
		return true
	}
	start := 0
	for i := 0; i <= len(ifNoneMatch); i++ {
		if i == len(ifNoneMatch) || ifNoneMatch[i] == ',' {
			candidate := trimSpace(ifNoneMatch[start:i])
			// Tolerate a weak-validator prefix on the client's sent value even
			// though we only ever emit strong ETags ourselves.
			candidate = trimWeakPrefix(candidate)
			if candidate == etag {
				return true
			}
			start = i + 1
		}
	}
	return false
}

func trimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}

func trimWeakPrefix(s string) string {
	if len(s) >= 2 && s[0] == 'W' && s[1] == '/' {
		return s[2:]
	}
	return s
}

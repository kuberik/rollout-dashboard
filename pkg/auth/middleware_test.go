package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestExtractTokenMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("Prioritize IdToken cookie over id_token cookie", func(t *testing.T) {
		r := gin.New()
		r.Use(ExtractTokenMiddleware())
		r.GET("/test", func(c *gin.Context) {
			token := GetTokenFromContext(c)
			c.String(http.StatusOK, token)
		})

		req, _ := http.NewRequest("GET", "/test", nil)
		req.AddCookie(&http.Cookie{Name: "IdToken", Value: "priority-token"})
		req.AddCookie(&http.Cookie{Name: "id_token", Value: "fallback-token"})

		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "priority-token", w.Body.String())
	})

	t.Run("Fallback to id_token cookie if IdToken not present", func(t *testing.T) {
		r := gin.New()
		r.Use(ExtractTokenMiddleware())
		r.GET("/test", func(c *gin.Context) {
			token := GetTokenFromContext(c)
			c.String(http.StatusOK, token)
		})

		req, _ := http.NewRequest("GET", "/test", nil)
		req.AddCookie(&http.Cookie{Name: "id_token", Value: "fallback-token"})

		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "fallback-token", w.Body.String())
	})

	t.Run("Prioritize cookies over Authorization header", func(t *testing.T) {
		r := gin.New()
		r.Use(ExtractTokenMiddleware())
		r.GET("/test", func(c *gin.Context) {
			token := GetTokenFromContext(c)
			c.String(http.StatusOK, token)
		})

		req, _ := http.NewRequest("GET", "/test", nil)
		req.Header.Set("Authorization", "Bearer header-token")
		req.AddCookie(&http.Cookie{Name: "IdToken", Value: "cookie-token"})

		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "cookie-token", w.Body.String())
	})
}

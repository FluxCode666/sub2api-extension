package update

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestVersionComparison(t *testing.T) {
	for _, tc := range []struct {
		latest, current string
		newer           bool
	}{
		{"v0.10.0", "v0.9.9", true}, {"v1.0.0", "1.0.0", false}, {"v0.5.0", "v0.6.0", false},
		{"v1.0.0", "v1.0.0-rc.1", true}, {"v1.0.0", "dev", false}, {"v01.0.0", "v0.5.0", false},
		{"v1.0.0;id", "v0.5.0", false}, {"v1.0.0-01", "v0.5.0", false},
	} {
		require.Equal(t, tc.newer, Newer(tc.latest, tc.current), "%s -> %s", tc.current, tc.latest)
	}
}

func TestGitHubReleaseValidationAndCache(t *testing.T) {
	for _, tc := range []struct {
		name, remote, manifest string
		fails                  bool
		hasManifest            bool
	}{
		{"valid", `{"tag_name":"v0.6.0","body":"中文发布说明","assets":[{"id":12,"name":"release-manifest.json"}]}`, `{"schema":1,"version":"v0.6.0","image":"` + DefaultImage + `","digest":"sha256:` + strings.Repeat("a", 64) + `"}`, false, true},
		{"old release", `{"tag_name":"v0.5.0"}`, "", false, false},
		{"prerelease", `{"tag_name":"v0.6.0-rc.1","prerelease":true}`, "", true, false},
		{"draft", `{"tag_name":"v0.6.0","draft":true}`, "", true, false},
		{"foreign image", `{"tag_name":"v0.6.0","assets":[{"id":12,"name":"release-manifest.json"}]}`, `{"schema":1,"version":"v0.6.0","image":"attacker/image","digest":"sha256:` + strings.Repeat("a", 64) + `"}`, true, false},
		{"wrong version", `{"tag_name":"v0.6.0","assets":[{"id":12,"name":"release-manifest.json"}]}`, `{"schema":1,"version":"v0.7.0","image":"` + DefaultImage + `","digest":"sha256:` + strings.Repeat("a", 64) + `"}`, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			g := &GitHub{Repository: DefaultRepository, Image: DefaultImage, Token: "private-test-token", Client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				require.Equal(t, "api.github.com", r.URL.Host)
				require.Equal(t, "Bearer private-test-token", r.Header.Get("Authorization"))
				body := tc.remote
				if strings.Contains(r.URL.Path, "/assets/") {
					body = tc.manifest
					require.Equal(t, "application/octet-stream", r.Header.Get("Accept"))
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
			})}}
			r, err := g.Latest(context.Background(), false)
			if tc.fails {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tc.hasManifest, r.Manifest != nil)
			before := calls
			_, err = g.Latest(context.Background(), false)
			require.NoError(t, err)
			require.Equal(t, before, calls)
			_, err = g.Latest(context.Background(), true)
			require.NoError(t, err)
			require.Greater(t, calls, before)
		})
	}
}

func TestGitHubErrorDoesNotExposeResponseOrToken(t *testing.T) {
	g := &GitHub{Repository: DefaultRepository, Client: &http.Client{Transport: transportFunc(func(*http.Request) (*http.Response, error) {
		return nil, fmt.Errorf("private-token-with-sensitive-details")
	})}}
	_, err := g.Latest(context.Background(), true)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "sensitive")
}

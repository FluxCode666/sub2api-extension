// Package update implements the in-process release updater.
package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"golang.org/x/mod/semver"
)

const DefaultRepository = "FluxCode666/sub2api-extension"

// DefaultImage is retained for compatibility with manifests from the previous
// container-based updater. It is never used as an update execution target.
const DefaultImage = "ghcr.io/fluxcode666/sub2api-extension"

const (
	archivePrefix       = "sub2api-extension"
	checksumsAssetName  = "checksums.txt"
	manifestAssetName   = "release-manifest.json"
	maxReleaseBodyBytes = 2 << 20
	maxDownloadSize     = 500 << 20
)

var (
	tagPattern        = regexp.MustCompile(`^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$`)
	repositoryPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
)

type Build struct {
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildTime string `json:"buildTime"`
}

// Manifest is retained for older Releases. New updates use binary assets;
// image metadata is informational and is never executed by the application.
type Manifest struct {
	Schema  int    `json:"schema"`
	Version string `json:"version"`
	Image   string `json:"image"`
	Digest  string `json:"digest"`
}

type Asset struct {
	Name        string `json:"name"`
	DownloadURL string `json:"downloadUrl"`
	Size        int64  `json:"size"`
}

type Release struct {
	Version     string    `json:"version"`
	Name        string    `json:"name"`
	Notes       string    `json:"notes"`
	URL         string    `json:"url"`
	PublishedAt string    `json:"publishedAt"`
	Assets      []Asset   `json:"assets,omitempty"`
	Manifest    *Manifest `json:"manifest,omitempty"`
}

func ValidVersion(version string) bool {
	return tagPattern.MatchString(version) && semver.IsValid("v"+strings.TrimPrefix(version, "v"))
}

func Newer(latest, current string) bool {
	return ValidVersion(latest) && ValidVersion(current) && semver.Compare("v"+strings.TrimPrefix(latest, "v"), "v"+strings.TrimPrefix(current, "v")) > 0
}

func (r *Release) HasCompatibleAsset() bool {
	if r == nil {
		return false
	}
	name := archiveName()
	for _, asset := range r.Assets {
		if asset.Name == name && asset.DownloadURL != "" {
			return true
		}
	}
	return false
}

type ReleaseSource interface {
	Latest(context.Context, bool) (*Release, error)
}

// GitHub only accesses the configured repository. Browser input never becomes
// a URL, image reference, or command.
type GitHub struct {
	Repository     string
	Image          string
	Token          string
	Client         *http.Client
	DownloadClient *http.Client
	mu             sync.Mutex
	cached         *Release
	cachedAt       time.Time
}

func NewGitHubFromEnv() *GitHub {
	repository := strings.TrimSpace(os.Getenv("SUB2API_EXTENSION_RELEASE_REPOSITORY"))
	if repository == "" {
		repository = DefaultRepository
	}
	image := strings.TrimSpace(os.Getenv("SUB2API_EXTENSION_IMAGE"))
	if image == "" {
		image = DefaultImage
	}
	return &GitHub{
		Repository:     repository,
		Image:          image,
		Token:          os.Getenv("SUB2API_EXTENSION_GITHUB_TOKEN"),
		Client:         &http.Client{Timeout: 12 * time.Second, CheckRedirect: stripGitHubAuth},
		DownloadClient: &http.Client{Timeout: 10 * time.Minute, CheckRedirect: stripGitHubAuth},
	}
}

func stripGitHubAuth(req *http.Request, _ []*http.Request) error {
	if !isGitHubAPIURL(req.URL) {
		req.Header.Del("Authorization")
	}
	return nil
}

func isGitHubAPIURL(parsed *url.URL) bool {
	return parsed != nil && strings.EqualFold(parsed.Scheme, "https") && parsed.User == nil && strings.EqualFold(parsed.Hostname(), "api.github.com")
}

func (g *GitHub) get(ctx context.Context, path, accept string, output any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/"+g.Repository+path, nil)
	if err != nil {
		return errors.New("发布地址配置无效")
	}
	req.Header.Set("Accept", accept)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "sub2api-extension-updater")
	if g.Token != "" {
		req.Header.Set("Authorization", "Bearer "+g.Token)
	}
	client := g.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("无法连接 GitHub，请稍后重试或检查服务器网络")
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		switch resp.StatusCode {
		case http.StatusNotFound:
			return errors.New("未找到正式 Release；私有仓库请配置 GitHub 访问令牌")
		case http.StatusForbidden, http.StatusTooManyRequests:
			return errors.New("GitHub 访问受限，请检查令牌权限或稍后重试")
		default:
			return fmt.Errorf("查询 GitHub 发布失败（HTTP %d）", resp.StatusCode)
		}
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxReleaseBodyBytes)).Decode(output); err != nil {
		return errors.New("发布信息格式无效")
	}
	return nil
}

func (g *GitHub) Latest(ctx context.Context, force bool) (*Release, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !repositoryPattern.MatchString(g.Repository) {
		return nil, errors.New("发布仓库配置无效，应为 owner/repository")
	}
	if !force && g.cached != nil && time.Since(g.cachedAt) < 5*time.Minute {
		return g.cached, nil
	}
	var remote struct {
		Tag         string `json:"tag_name"`
		Name        string `json:"name"`
		Body        string `json:"body"`
		PublishedAt string `json:"published_at"`
		Draft       bool   `json:"draft"`
		Prerelease  bool   `json:"prerelease"`
		Assets      []struct {
			ID                 int64  `json:"id"`
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
			Size               int64  `json:"size"`
		} `json:"assets"`
	}
	if err := g.get(ctx, "/releases/latest", "application/vnd.github+json", &remote); err != nil {
		return nil, err
	}
	if !ValidVersion(remote.Tag) || strings.Contains(remote.Tag, "-") || remote.Draft || remote.Prerelease {
		return nil, errors.New("最新发布不是有效的正式版本")
	}
	release := &Release{
		Version:     remote.Tag,
		Name:        remote.Name,
		Notes:       remote.Body,
		PublishedAt: remote.PublishedAt,
		URL:         "https://github.com/" + g.Repository + "/releases/tag/" + remote.Tag,
		Assets:      make([]Asset, 0, len(remote.Assets)),
	}
	for _, asset := range remote.Assets {
		if asset.Name == manifestAssetName && asset.ID > 0 {
			var manifest Manifest
			if err := g.get(ctx, fmt.Sprintf("/releases/assets/%d", asset.ID), "application/octet-stream", &manifest); err != nil {
				return nil, err
			}
			if manifest.Schema != 1 || manifest.Version != release.Version || (g.Image != "" && manifest.Image != "" && manifest.Image != g.Image) {
				return nil, errors.New("发布清单与版本不匹配，不能执行更新")
			}
			release.Manifest = &manifest
			continue
		}
		if asset.BrowserDownloadURL == "" {
			continue
		}
		release.Assets = append(release.Assets, Asset{Name: asset.Name, DownloadURL: asset.BrowserDownloadURL, Size: asset.Size})
	}
	g.cached, g.cachedAt = release, time.Now()
	return release, nil
}

func (g *GitHub) DownloadFile(ctx context.Context, rawURL, dest string) error {
	if err := validateDownloadURL(rawURL); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "sub2api-extension-updater")
	if g.Token != "" && isGitHubAPIURL(req.URL) {
		req.Header.Set("Authorization", "Bearer "+g.Token)
	}
	client := g.DownloadClient
	if client == nil {
		client = g.Client
	}
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("无法下载更新文件，请稍后重试或检查服务器网络")
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载更新文件失败（HTTP %d）", resp.StatusCode)
	}
	if resp.ContentLength > maxDownloadSize {
		return errors.New("更新文件超过大小限制")
	}
	f, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(f, io.LimitReader(resp.Body, maxDownloadSize+1))
	closeErr := f.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if info, err := os.Stat(dest); err != nil || info.Size() > maxDownloadSize {
		return errors.New("更新文件超过大小限制")
	}
	return nil
}

func (g *GitHub) FetchChecksumFile(ctx context.Context, rawURL string) ([]byte, error) {
	if err := validateDownloadURL(rawURL); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "sub2api-extension-updater")
	if g.Token != "" && isGitHubAPIURL(req.URL) {
		req.Header.Set("Authorization", "Bearer "+g.Token)
	}
	client := g.DownloadClient
	if client == nil {
		client = g.Client
	}
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("无法下载更新校验文件，请稍后重试或检查服务器网络")
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("下载更新校验文件失败（HTTP %d）", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
}

func validateDownloadURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil {
		return errors.New("更新下载地址无效")
	}
	if !isGitHubHost(parsed) && !strings.EqualFold(parsed.Hostname(), "objects.githubusercontent.com") {
		return fmt.Errorf("更新下载地址不是受信任的 GitHub 地址: %s", parsed.Host)
	}
	return nil
}

func isGitHubHost(parsed *url.URL) bool {
	if parsed == nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "github.com" || strings.HasSuffix(host, ".github.com")
}

func archiveName() string {
	return fmt.Sprintf("%s_%s_%s.tar.gz", archivePrefix, runtime.GOOS, runtime.GOARCH)
}

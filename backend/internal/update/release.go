// Package update 提供版本发布查询和独立容器更新服务使用的协议。
package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/mod/semver"
)

const DefaultRepository = "FluxCode666/sub2api-extension"
const DefaultImage = "ghcr.io/fluxcode666/sub2api-extension"

var tagPattern = regexp.MustCompile(`^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$`)
var digestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
var repositoryPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

type Build struct {
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildTime string `json:"buildTime"`
}

type Manifest struct {
	Schema  int    `json:"schema"`
	Version string `json:"version"`
	Image   string `json:"image"`
	Digest  string `json:"digest"`
}

type Release struct {
	Version     string    `json:"version"`
	Name        string    `json:"name"`
	Notes       string    `json:"notes"`
	URL         string    `json:"url"`
	PublishedAt string    `json:"publishedAt"`
	Manifest    *Manifest `json:"manifest,omitempty"`
}

func ValidVersion(version string) bool {
	return tagPattern.MatchString(version) && semver.IsValid("v"+strings.TrimPrefix(version, "v"))
}

func Newer(latest, current string) bool {
	return ValidVersion(latest) && ValidVersion(current) && semver.Compare("v"+strings.TrimPrefix(latest, "v"), "v"+strings.TrimPrefix(current, "v")) > 0
}

type ReleaseSource interface {
	Latest(context.Context, bool) (*Release, error)
}

// GitHub 仅访问运维配置的固定仓库；浏览器不能指定 URL、镜像或命令。
type GitHub struct {
	Repository string
	Image      string
	Token      string
	Client     *http.Client
	mu         sync.Mutex
	cached     *Release
	cachedAt   time.Time
}

func NewGitHubFromEnv() *GitHub {
	repository := os.Getenv("SUB2API_EXTENSION_RELEASE_REPOSITORY")
	if repository == "" {
		repository = DefaultRepository
	}
	image := os.Getenv("SUB2API_EXTENSION_IMAGE")
	if image == "" {
		image = DefaultImage
	}
	return &GitHub{Repository: repository, Image: image, Token: os.Getenv("SUB2API_EXTENSION_GITHUB_TOKEN"), Client: &http.Client{Timeout: 12 * time.Second}}
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
	resp, err := g.Client.Do(req)
	if err != nil {
		return errors.New("无法连接 GitHub，请稍后重试或检查服务器网络")
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == 404 {
			return errors.New("未找到正式 Release；私有仓库请配置 GitHub 访问令牌")
		}
		if resp.StatusCode == 403 || resp.StatusCode == 429 {
			return errors.New("GitHub 访问受限，请检查令牌权限或稍后重试")
		}
		return fmt.Errorf("查询 GitHub 发布失败（HTTP %d）", resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(output); err != nil {
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
			ID   int64  `json:"id"`
			Name string `json:"name"`
		} `json:"assets"`
	}
	if err := g.get(ctx, "/releases/latest", "application/vnd.github+json", &remote); err != nil {
		return nil, err
	}
	if !ValidVersion(remote.Tag) || strings.Contains(remote.Tag, "-") || remote.Draft || remote.Prerelease {
		return nil, errors.New("最新发布不是有效的正式版本")
	}
	release := &Release{Version: remote.Tag, Name: remote.Name, Notes: remote.Body, PublishedAt: remote.PublishedAt, URL: "https://github.com/" + g.Repository + "/releases/tag/" + remote.Tag}
	for _, asset := range remote.Assets {
		if asset.Name != "release-manifest.json" || asset.ID <= 0 {
			continue
		}
		var manifest Manifest
		if err := g.get(ctx, fmt.Sprintf("/releases/assets/%d", asset.ID), "application/octet-stream", &manifest); err != nil {
			return nil, err
		}
		if manifest.Schema != 1 || manifest.Version != release.Version || manifest.Image != g.Image || !digestPattern.MatchString(manifest.Digest) {
			return nil, errors.New("发布清单与版本或配置的镜像不匹配，不能执行更新")
		}
		release.Manifest = &manifest
		break
	}
	g.cached, g.cachedAt = release, time.Now()
	return release, nil
}

//go:build embed

package web

import (
	"embed"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// SeedClientAssets 将客户端接入文档截图与客户端图标种子资源复制到系统统一资源目录。
//
// 仅补齐缺失文件，不覆盖已有文件：管理员在持久卷上修改过的资源不会被镜像升级冲掉，
// 新版本新增的资源文件会在下次启动时补齐。目录树与 embedded seed 完全一致。
//
//go:embed seed
var seedFS embed.FS

func SeedClientAssets(assetDir string) error {
	dir := strings.TrimSpace(assetDir)
	if dir == "" {
		return nil
	}
	seeded := 0
	err := fs.WalkDir(seedFS, "seed", func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		rel := strings.TrimPrefix(p, "seed/")
		if rel == p {
			return nil // 根目录文件(不应出现)，跳过
		}
		base := filepath.Base(rel)
		if base == "placeholder.txt" || strings.HasPrefix(base, ".") {
			return nil // 占位与隐藏文件不落盘
		}
		target := filepath.Join(dir, filepath.FromSlash(rel))
		if _, err := os.Stat(target); err == nil {
			return nil // 已存在，保留卷上版本
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return err
		}
		data, err := seedFS.ReadFile(p)
		if err != nil {
			return err
		}
		if err := os.WriteFile(target, data, 0o640); err != nil {
			return err
		}
		seeded++
		return nil
	})
	if err != nil {
		return err
	}
	if seeded > 0 {
		log.Printf("[SeedClientAssets] seeded %d client resource files into %q", seeded, dir)
	}
	return nil
}

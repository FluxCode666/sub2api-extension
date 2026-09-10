//go:build embed

package web

import (
	"os"
	"path/filepath"
	"testing"
)

// TestSeedClientAssets 验证种子复制行为：补齐缺失文件、跳过占位文件、不覆盖已有文件。
//
// 仅在 embed 构建且 seed 目录被发布镜像填充后有意义
// (Dockerfile 将 backend/data/assets/client-docs 与 client-icons COPY 进 seed/)。
// 源码目录未填充时跳过。
func TestSeedClientAssets(t *testing.T) {
	seedDocs := filepath.Join("seed", "client-docs")
	if _, err := os.Stat(seedDocs); err != nil {
		t.Skipf("seed assets not populated in this build layout: %v", err)
	}

	dir := t.TempDir()
	if err := SeedClientAssets(dir); err != nil {
		t.Fatalf("first seed failed: %v", err)
	}

	png := filepath.Join(dir, "client-docs", "claude-code", "cc-switch.png")
	if _, err := os.Stat(png); err != nil {
		t.Fatalf("expected seeded png at %s: %v", png, err)
	}
	svg := filepath.Join(dir, "client-icons", "claude-code.svg")
	if _, err := os.Stat(svg); err != nil {
		t.Fatalf("expected seeded svg at %s: %v", svg, err)
	}
	// 占位文件不落盘
	for _, junk := range []string{
		filepath.Join(dir, "placeholder.txt"),
		filepath.Join(dir, "client-docs", "placeholder.txt"),
	} {
		if _, err := os.Stat(junk); err == nil {
			t.Fatalf("placeholder must not be seeded: %s", junk)
		}
	}

	// 已有文件不被覆盖(管理员修改保留)
	custom := []byte("admin edit")
	if err := os.WriteFile(png, custom, 0o640); err != nil {
		t.Fatalf("write custom png: %v", err)
	}
	if err := SeedClientAssets(dir); err != nil {
		t.Fatalf("second seed failed: %v", err)
	}
	got, err := os.ReadFile(png)
	if err != nil {
		t.Fatalf("read png: %v", err)
	}
	if string(got) != string(custom) {
		t.Fatalf("seeding must not overwrite existing files, got %q", got)
	}
}
